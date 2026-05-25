# Duplicate Ticket Detection & Merge Feature

## Overview
This feature enables departmental managers to identify and merge duplicate tickets with automatic notifications to admins, bootstrap admins, and other managers.

## Features Implemented

### 1. Duplicate Detection Algorithm
- Fuzzy matching on ticket titles (using Levenshtein distance)
- Same requester and category matching
- Similar description matching
- Date proximity (within 7 days)

### 2. Merge Functionality
- Only departmental managers can merge tickets
- Merge confirmation dialog
- Combines comments, activities, and metadata
- Keeps primary ticket, archives merged tickets

### 3. Notifications
- Email notifications with:
  - Merged ticket numbers
  - Ticket titles and details
  - Merge reason/action
  - Link to ticket
- Push notifications (real-time alerts)

### 4. Dashboard Integration
- New "Duplicate Tickets" section
- Shows groups of potential duplicates
- Merge button for each group
- Status indicator

## Implementation Steps

### Step 1: Add Duplicate Detection Function
```javascript
// Levenshtein distance for fuzzy matching
const levenshteinDistance = (str1, str2) => {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(0));
  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      );
    }
  }
  return matrix[str2.length][str1.length];
};

// Find duplicate tickets
const findDuplicates = (tickets, threshold = 0.7) => {
  const duplicateGroups = [];
  const processed = new Set();

  tickets.forEach((t1, idx1) => {
    if (processed.has(t1.id)) return;
    
    const group = [t1];
    processed.add(t1.id);

    tickets.slice(idx1 + 1).forEach(t2 => {
      if (processed.has(t2.id)) return;
      
      // Similarity check
      const titleSim = 1 - (levenshteinDistance(t1.title.toLowerCase(), t2.title.toLowerCase()) / Math.max(t1.title.length, t2.title.length));
      const sameRequester = t1.requesterId === t2.requesterId;
      const sameCategory = t1.category === t2.category;
      const dateProximity = Math.abs(new Date(t1.createdAt) - new Date(t2.createdAt)) < 7 * 24 * 60 * 60 * 1000;
      
      const descSim = t1.description && t2.description ? 
        1 - (levenshteinDistance(t1.description.toLowerCase(), t2.description.toLowerCase()) / Math.max(t1.description.length, t2.description.length)) : 0;
      
      // Calculate combined score
      const score = (titleSim * 0.4) + (sameRequester ? 0.2 : 0) + (sameCategory ? 0.2 : 0) + (dateProximity ? 0.1 : 0) + (descSim * 0.1);
      
      if (score >= threshold) {
        group.push(t2);
        processed.add(t2.id);
      }
    });
    
    if (group.length > 1) {
      duplicateGroups.push(group);
    }
  });

  return duplicateGroups;
};
```

### Step 2: Add Merge Function
```javascript
const mergeTickets = async (primaryTicketId, mergeTicketIds, mergeReason, currentUserId) => {
  try {
    // Get full ticket data
    const primary = tickets.find(t => t.id === primaryTicketId);
    const toMerge = tickets.filter(t => mergeTicketIds.includes(t.id));
    
    if (!primary) throw new Error('Primary ticket not found');
    if (toMerge.length === 0) throw new Error('No tickets to merge');
    
    // Combine data
    const mergedComments = [
      ...primary.comments,
      ...toMerge.flatMap(t => (t.comments || []).map(c => ({ ...c, sourceTicket: t.ticketNumber })))
    ];

    const mergedActivity = [
      ...primary.activity,
      ...toMerge.flatMap(t => (t.activity || []).map(a => ({ ...a, sourceTicket: t.ticketNumber }))),
      {
        id: uid(),
        at: new Date().toISOString(),
        userId: currentUserId,
        type: 'merged',
        text: `Merged tickets: ${toMerge.map(t => t.ticketNumber).join(', ')} | Reason: ${mergeReason}`
      }
    ];

    // Update primary ticket
    const updatedPrimary = {
      ...primary,
      comments: mergedComments,
      activity: mergedActivity,
      updatedAt: new Date().toISOString(),
      mergedWith: toMerge.map(t => t.id)
    };

    // Archive merged tickets
    const archivedTickets = toMerge.map(t => ({
      ...t,
      status: 'archived',
      archivedAt: new Date().toISOString(),
      mergedInto: primaryTicketId,
      updatedAt: new Date().toISOString()
    }));

    return { updatedPrimary, archivedTickets };
  } catch (error) {
    console.error('Merge error:', error);
    throw error;
  }
};
```

### Step 3: Send Notifications

#### Email Notification
```javascript
const sendMergeNotifications = async (primaryTicket, mergedTickets, mergedBy, managers, admins) => {
  const mergeDetails = {
    primaryTicket: primaryTicket.ticketNumber,
    primaryTitle: primaryTicket.title,
    mergedTickets: mergedTickets.map(t => ({ number: t.ticketNumber, title: t.title })),
    mergedBy: mergedBy.name,
    mergedByEmail: mergedBy.email,
    timestamp: new Date().toLocaleString('en-AU'),
    category: primaryTicket.category,
    requester: primaryTicket.requesterName
  };

  const emailBody = `
    <h2>Duplicate Tickets Merged</h2>
    <p>The following duplicate tickets have been merged:</p>
    
    <h3>Primary Ticket</h3>
    <ul>
      <li><strong>Ticket:</strong> ${mergeDetails.primaryTicket}</li>
      <li><strong>Title:</strong> ${mergeDetails.primaryTitle}</li>
      <li><strong>Category:</strong> ${mergeDetails.category}</li>
      <li><strong>Requester:</strong> ${mergeDetails.requester}</li>
    </ul>
    
    <h3>Merged Tickets</h3>
    <ul>
      ${mergeDetails.mergedTickets.map(t => `<li>${t.number}: ${t.title}</li>`).join('')}
    </ul>
    
    <h3>Merge Details</h3>
    <ul>
      <li><strong>Merged By:</strong> ${mergeDetails.mergedBy} (${mergeDetails.mergedByEmail})</li>
      <li><strong>Timestamp:</strong> ${mergeDetails.timestamp}</li>
    </ul>
    
    <p><a href="http://localhost:4000/ticket/${primaryTicket.id}">View Merged Ticket</a></p>
  `;

  // Send to admins, bootstrap admins, and managers
  const recipients = [
    ...admins.filter(u => u.active),
    ...managers.filter(u => u.active)
  ];

  for (const recipient of recipients) {
    try {
      // Call your email service
      await sendEmail({
        to: recipient.email,
        subject: `Tickets Merged: ${primaryTicket.ticketNumber}`,
        html: emailBody
      });

      // Push notification
      await sendPushNotification({
        userId: recipient.id,
        title: 'Duplicate Tickets Merged',
        message: `${mergeDetails.mergedTickets.length} duplicate ticket(s) merged into ${primaryTicket.ticketNumber}`,
        data: {
          type: 'ticket_merge',
          primaryTicketId: primaryTicket.id,
          mergedCount: mergeDetails.mergedTickets.length
        }
      });
    } catch (error) {
      console.error(`Failed to notify ${recipient.email}:`, error);
    }
  }
};
```

### Step 4: Add Dashboard UI Component

Add this to the Dashboard component:

```jsx
{duplicates.length > 0 && (
  <div className="card p-6 mb-6 border-l-4 border-amber-500">
    <div className="flex items-center gap-3 mb-4">
      <Icon name="alert" className="w-5 h-5 text-amber-600" />
      <h2 className="font-semibold text-slate-800">{duplicates.length} Potential Duplicate Group(s)</h2>
    </div>

    <div className="space-y-4">
      {duplicates.map((group, idx) => (
        <div key={idx} className="border border-amber-200 rounded-lg p-4 bg-amber-50">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-medium text-slate-700">{group.length} similar tickets found</p>
              <p className="text-xs text-slate-500 mt-1">
                {group.map(t => t.ticketNumber).join(', ')}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            {group.map(ticket => (
              <div key={ticket.id} className="border border-amber-200 rounded p-3 bg-white">
                <p className="font-mono text-sm font-semibold text-slate-800">{ticket.ticketNumber}</p>
                <p className="text-sm text-slate-700 truncate">{ticket.title}</p>
                <p className="text-xs text-slate-500 mt-1">
                  Requester: {users.find(u => u.id === ticket.requesterId)?.name}
                </p>
              </div>
            ))}
          </div>

          {(currentUser.role === 'manager' || currentUser.role === 'super_admin') && (
            <button
              onClick={() => {
                // Show merge dialog
                const selectedIds = group.slice(1).map(t => t.id);
                openMergeDialog(group[0].id, selectedIds);
              }}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700"
            >
              Merge These Tickets
            </button>
          )}
        </div>
      ))}
    </div>
  </div>
)}
```

### Step 5: Merge Confirmation Dialog

```jsx
const MergeDialog = ({ primaryTicket, mergeTickets, onMerge, onCancel, currentUser }) => {
  const [reason, setReason] = useState('');
  const [merging, setMerging] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full">
        <h2 className="text-xl font-semibold text-slate-900 mb-4">Merge Duplicate Tickets</h2>
        
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-slate-700 mb-2"><strong>Primary Ticket:</strong></p>
          <p className="font-mono text-sm font-semibold">{primaryTicket.ticketNumber}: {primaryTicket.title}</p>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-slate-700 mb-2"><strong>Will be merged:</strong></p>
          <div className="space-y-1">
            {mergeTickets.map(t => (
              <p key={t.id} className="font-mono text-sm">{t.ticketNumber}: {t.title}</p>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-2">Reason for Merge</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why these tickets are duplicates..."
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            rows="3"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              setMerging(true);
              onMerge(primaryTicket.id, mergeTickets.map(t => t.id), reason);
            }}
            disabled={!reason.trim() || merging}
            className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            {merging ? 'Merging...' : 'Confirm Merge'}
          </button>
        </div>
      </div>
    </div>
  );
};
```

## Implementation Checklist

- [ ] Add `levenshteinDistance` function
- [ ] Add `findDuplicates` function to Dashboard
- [ ] Add `mergeTickets` function
- [ ] Add `sendMergeNotifications` function
- [ ] Create MergeDialog component
- [ ] Add duplicate detection section to Dashboard
- [ ] Wire up merge button to trigger notifications
- [ ] Test email notifications
- [ ] Test push notifications
- [ ] Add merge history to ticket details

## Usage

1. **On Dashboard**: Scroll to "Potential Duplicate Groups" section
2. **Review**: Check the similar tickets in each group
3. **Merge**: Click "Merge These Tickets" button
4. **Confirm**: Choose primary ticket, enter reason, and confirm
5. **Notify**: Emails and push notifications automatically sent to all admins and managers
6. **Result**: Merged ticket replaces duplicates, all comments/activities preserved

---

**Do you want me to integrate all of this code into your frontend now?** I can add the duplicate detection, merge UI, and notification system directly! 🚀
