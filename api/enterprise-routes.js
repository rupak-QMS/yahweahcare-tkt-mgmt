/**
 * Enterprise Approval Workflow Routes
 * Add to server.js: const enterpriseRoutes = require('./enterprise-routes.js')(pool);
 * Then: app.use('/api', enterpriseRoutes);
 */

const express = require('express');

module.exports = function(pool, sendPushToUser, queueEmail) {
    // Fallback no-ops so callers don't need to pass them
    if (typeof sendPushToUser !== 'function') sendPushToUser = async () => {};
    if (typeof queueEmail    !== 'function') queueEmail    = async () => {};

    const router = express.Router();

    // ==================== CREATE TICKET WITH APPROVERS ====================
    router.post('/tickets', async (req, res) => {
        const client = await pool.connect();
        try {
            const {
                title, description, category_id, priority_id,
                created_by, assigned_to, due_date, approval_mode, approver_ids
            } = req.body;

            // Validation: prevent self-assignment
            if (created_by === assigned_to) {
                return res.status(400).json({
                    error: 'Ticket creator cannot assign the ticket to themselves.'
                });
            }

            // Validation: require at least one approver
            if (!approver_ids || approver_ids.length === 0) {
                return res.status(400).json({
                    error: 'At least one approver must be selected.'
                });
            }

            await client.query('BEGIN');

            // Create ticket
            const ticketResult = await client.query(
                `INSERT INTO yc_tkt_mgmt.tickets
                (title, description, category_id, priority_id, created_by, assigned_to, due_date, approval_mode, approver_required)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
                RETURNING *`,
                [title, description, category_id, priority_id, created_by, assigned_to, due_date, approval_mode]
            );
            const ticket = ticketResult.rows[0];

            // Add approvers
            for (const approverId of approver_ids) {
                await client.query(
                    `INSERT INTO yc_tkt_mgmt.ticket_approvers (ticket_id, approver_user_id)
                    VALUES ($1, $2)`,
                    [ticket.id, approverId]
                );
            }

            // Log audit
            await client.query(
                `INSERT INTO yc_tkt_mgmt.ticket_audit_log
                (ticket_id, action_type, new_value, changed_by)
                VALUES ($1, $2, $3, $4)`,
                [ticket.id, 'Created', JSON.stringify(ticket), created_by]
            );

            // Create notifications for approvers + push + email
            for (const approverId of approver_ids) {
                await client.query(
                    `INSERT INTO yc_tkt_mgmt.notifications
                    (user_id, ticket_id, notification_type, title, message, related_user_id, push_sent)
                    VALUES ($1, $2, $3, $4, $5, $6, false)`,
                    [
                        approverId,
                        ticket.id,
                        'ApprovalRequested',
                        `Approval Required: ${title}`,
                        `New ticket requires your approval.`,
                        created_by
                    ]
                );
                // Push notification
                sendPushToUser(pool, approverId, {
                    title: `Approval Required: ${title}`,
                    body:  'A new ticket requires your approval.',
                    data:  { url: '/#tickets' },
                }).catch(() => {});
            }

            // Queue email to each approver
            const approverEmails = await pool.query(
                `SELECT id, email, name FROM yc_tkt_mgmt.users WHERE id = ANY($1::int[])`,
                [approver_ids]
            );
            for (const approver of approverEmails.rows) {
                await queueEmail(pool, {
                    to:        approver.email,
                    subject:   `[Yahweahcare] Approval Required: ${title}`,
                    bodyText:  `Hi ${approver.name.split(' ')[0]},\n\nA new ticket requires your approval.\n\nTicket: ${title}\nPriority: ${priority_id || 'Medium'}\n\nPlease log in to review and approve or reject this ticket.`,
                    ticketId:  ticket.id,
                    ticketRef: ticket.ticket_number || `#${ticket.id}`,
                    eventName: 'ApprovalRequested',
                });
            }

            await client.query('COMMIT');

            res.status(201).json({
                message: 'Ticket created successfully',
                ticket: ticket,
                approvers_count: approver_ids.length
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error creating ticket:', error);
            res.status(500).json({ error: error.message });
        } finally {
            client.release();
        }
    });

    // ==================== GET PENDING APPROVALS ====================
    router.get('/approvals/pending/:user_id', async (req, res) => {
        try {
            const { user_id } = req.params;

            const result = await pool.query(
                `SELECT t.id, t.title, t.priority_id, t.resolution_summary,
                        u_creator.name as created_by_name,
                        u_assignee.name as assigned_to_name,
                        ta.created_date as approval_due_date,
                        ta.approval_status,
                        c.label as category_label,
                        p.label as priority_label
                FROM yc_tkt_mgmt.tickets t
                JOIN yc_tkt_mgmt.ticket_approvers ta ON t.id = ta.ticket_id
                LEFT JOIN yc_tkt_mgmt.users u_creator ON t.created_by = u_creator.id
                LEFT JOIN yc_tkt_mgmt.users u_assignee ON t.assigned_to = u_assignee.id
                LEFT JOIN yc_tkt_mgmt.categories c ON t.category_id = c.id
                LEFT JOIN yc_tkt_mgmt.priorities p ON t.priority_id = p.id
                WHERE ta.approver_user_id = $1
                  AND ta.approval_status = 'Pending'
                  AND t.is_deleted = false
                ORDER BY ta.created_date ASC`,
                [user_id]
            );

            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching pending approvals:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ==================== SUBMIT APPROVAL ====================
    router.post('/tickets/:id/approval', async (req, res) => {
        const client = await pool.connect();
        try {
            const { id } = req.params;
            const { approver_id, approval_status, comments } = req.body;

            // Validation
            if (!['Approved', 'Rejected'].includes(approval_status)) {
                return res.status(400).json({
                    error: 'Approval status must be "Approved" or "Rejected".'
                });
            }

            await client.query('BEGIN');

            // Update approval record
            await client.query(
                `UPDATE yc_tkt_mgmt.ticket_approvers
                SET approval_status = $1,
                    approval_date = CURRENT_TIMESTAMP,
                    comments = $2,
                    action_taken_by = $3,
                    updated_date = CURRENT_TIMESTAMP
                WHERE ticket_id = $4 AND approver_user_id = $5`,
                [approval_status, comments, approver_id, id, approver_id]
            );

            // Get ticket info
            const ticketResult = await client.query(
                `SELECT * FROM yc_tkt_mgmt.tickets WHERE id = $1`,
                [id]
            );
            const ticket = ticketResult.rows[0];

            // Log audit
            await client.query(
                `INSERT INTO yc_tkt_mgmt.ticket_audit_log
                (ticket_id, action_type, new_value, changed_by)
                VALUES ($1, $2, $3, $4)`,
                [id, approval_status, JSON.stringify({ approval_status, comments }), approver_id]
            );

            // Helper: notify recipients with push + email
            async function notifyRecipients(recipientIds, notifType, notifTitle, notifMsg, pushBody, emailSubject, emailBodyFn) {
                // Look up user details for email/push
                const userRows = recipientIds.filter(Boolean);
                if (!userRows.length) return;
                const usersRes = await pool.query(
                    `SELECT id, email, name FROM yc_tkt_mgmt.users WHERE id = ANY($1::int[])`,
                    [userRows]
                );
                for (const u of usersRes.rows) {
                    await client.query(
                        `INSERT INTO yc_tkt_mgmt.notifications
                        (user_id, ticket_id, notification_type, title, message, related_user_id, push_sent)
                        VALUES ($1, $2, $3, $4, $5, $6, false)`,
                        [u.id, id, notifType, notifTitle, notifMsg, approver_id]
                    );
                    // Push
                    sendPushToUser(pool, u.id, {
                        title: notifTitle,
                        body:  pushBody,
                        data:  { url: '/#tickets' },
                    }).catch(() => {});
                    // Email
                    await queueEmail(pool, {
                        to:        u.email,
                        subject:   emailSubject,
                        bodyText:  emailBodyFn(u),
                        ticketId:  id,
                        ticketRef: ticket.ticket_number || `#${id}`,
                        eventName: notifType,
                    });
                }
            }

            // Handle approval based on mode
            if (approval_status === 'Approved') {
                if (ticket.approval_mode === 'AnyOne') {
                    await client.query(
                        `UPDATE yc_tkt_mgmt.tickets
                        SET closed_date = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                        WHERE id = $1`, [id]
                    );
                    await notifyRecipients(
                        [ticket.created_by, ticket.assigned_to],
                        'TicketClosed',
                        `Ticket Approved: ${ticket.title}`,
                        'Your ticket has been approved and closed.',
                        'Your ticket has been approved and closed.',
                        `[Yahweahcare] Ticket Approved: ${ticket.title}`,
                        u => `Hi ${u.name.split(' ')[0]},\n\nYour ticket "${ticket.title}" has been approved and closed.\n\n— Yahweahcare Service Desk`
                    );
                } else if (ticket.approval_mode === 'AllMustApprove') {
                    const pendingResult = await client.query(
                        `SELECT COUNT(*) as pending_count FROM yc_tkt_mgmt.ticket_approvers
                        WHERE ticket_id = $1 AND approval_status = 'Pending'`, [id]
                    );
                    if (pendingResult.rows[0].pending_count === 0) {
                        await client.query(
                            `UPDATE yc_tkt_mgmt.tickets
                            SET closed_date = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                            WHERE id = $1`, [id]
                        );
                        await notifyRecipients(
                            [ticket.created_by, ticket.assigned_to],
                            'TicketClosed',
                            `Ticket Approved: ${ticket.title}`,
                            'Your ticket has been approved by all approvers and closed.',
                            'Your ticket has been approved and closed.',
                            `[Yahweahcare] Ticket Approved: ${ticket.title}`,
                            u => `Hi ${u.name.split(' ')[0]},\n\nYour ticket "${ticket.title}" has been approved by all required approvers and is now closed.\n\n— Yahweahcare Service Desk`
                        );
                    }
                }
            } else if (approval_status === 'Rejected') {
                await notifyRecipients(
                    [ticket.created_by, ticket.assigned_to],
                    'TicketRejected',
                    `Ticket Rejected: ${ticket.title}`,
                    `Your ticket was rejected. Reason: ${comments}`,
                    'Your ticket has been rejected.',
                    `[Yahweahcare] Ticket Rejected: ${ticket.title}`,
                    u => `Hi ${u.name.split(' ')[0]},\n\nYour ticket "${ticket.title}" was rejected.\n\nReason: ${comments || 'No reason provided.'}\n\n— Yahweahcare Service Desk`
                );
            }

            await client.query('COMMIT');

            res.json({
                message: `Ticket ${approval_status.toLowerCase()} successfully.`,
                approval_status
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error submitting approval:', error);
            res.status(500).json({ error: error.message });
        } finally {
            client.release();
        }
    });

    // ==================== GET LOOKUPS ====================
    router.get('/lookups', async (req, res) => {
        try {
            const [categories, priorities, users] = await Promise.all([
                pool.query(`SELECT * FROM yc_tkt_mgmt.categories ORDER BY sort_order`),
                pool.query(`SELECT * FROM yc_tkt_mgmt.priorities ORDER BY sort_order`),
                pool.query(`SELECT id, name, email FROM yc_tkt_mgmt.users WHERE is_active = true ORDER BY name`)
            ]);

            res.json({
                categories: categories.rows,
                priorities: priorities.rows,
                users: users.rows
            });
        } catch (error) {
            console.error('Error fetching lookups:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ==================== GET USERS ====================
    router.get('/users', async (req, res) => {
        try {
            const result = await pool.query(
                `SELECT id, name, email FROM yc_tkt_mgmt.users
                WHERE is_active = true
                ORDER BY name`
            );
            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching users:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
};
