/**
 * Enterprise Components
 * Approver Dashboard & Enhanced Create Ticket
 * Inject these into index.html
 */

// ==================== APPROVERS SECTION (Add to CreateTicket form) ====================

const ApproversSection = ({ formData, setFormData, users }) => {
    const [selectedApprovers, setSelectedApprovers] = React.useState([]);
    const [showApproverModal, setShowApproverModal] = React.useState(false);

    const handleAddApprover = (userId) => {
        if (!selectedApprovers.includes(userId)) {
            setSelectedApprovers([...selectedApprovers, userId]);
            setFormData(prev => ({ ...prev, approver_ids: [...selectedApprovers, userId] }));
        }
    };

    const handleRemoveApprover = (userId) => {
        const updated = selectedApprovers.filter(id => id !== userId);
        setSelectedApprovers(updated);
        setFormData(prev => ({ ...prev, approver_ids: updated }));
    };

    const availableApprovers = users.filter(u => !selectedApprovers.includes(u.id) && u.id !== formData.created_by);

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                <span>✅</span> Approval Configuration
            </h2>

            <div className="mb-6">
                <label className="block text-sm font-medium text-gray-900 mb-2">Approval Mode *</label>
                <div className="grid grid-cols-2 gap-4">
                    <button
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, approval_mode: 'AnyOne' }))}
                        className={`p-4 border-2 rounded-lg text-left transition ${
                            formData.approval_mode === 'AnyOne'
                                ? 'border-blue-600 bg-blue-50'
                                : 'border-gray-200 hover:border-gray-300'
                        }`}
                    >
                        <p className="font-semibold text-gray-900">Any One</p>
                        <p className="text-xs text-gray-600">First approval closes ticket</p>
                    </button>
                    <button
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, approval_mode: 'AllMustApprove' }))}
                        className={`p-4 border-2 rounded-lg text-left transition ${
                            formData.approval_mode === 'AllMustApprove'
                                ? 'border-blue-600 bg-blue-50'
                                : 'border-gray-200 hover:border-gray-300'
                        }`}
                    >
                        <p className="font-semibold text-gray-900">All Must Approve</p>
                        <p className="text-xs text-gray-600">All approvers must agree</p>
                    </button>
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                    Select Approvers * {selectedApprovers.length > 0 && `(${selectedApprovers.length})`}
                </label>

                {selectedApprovers.length > 0 && (
                    <div className="mb-4 flex flex-wrap gap-2">
                        {selectedApprovers.map(approverId => {
                            const user = users.find(u => u.id === approverId);
                            return (
                                <div key={approverId} className="flex items-center gap-2 bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm">
                                    <span>{user?.name}</span>
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveApprover(approverId)}
                                        className="hover:text-blue-900 font-bold"
                                    >
                                        ×
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}

                <button
                    type="button"
                    onClick={() => setShowApproverModal(true)}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-left text-gray-700 hover:bg-gray-50 transition"
                >
                    + Add Approvers
                </button>

                {showApproverModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                            <h3 className="text-lg font-bold text-gray-900 mb-4">Select Approvers</h3>
                            <div className="space-y-2 max-h-96 overflow-y-auto mb-4">
                                {availableApprovers.map(user => (
                                    <button
                                        key={user.id}
                                        type="button"
                                        onClick={() => {
                                            handleAddApprover(user.id);
                                            setShowApproverModal(false);
                                        }}
                                        className="w-full text-left p-3 border border-gray-200 rounded hover:bg-blue-50 transition"
                                    >
                                        <p className="font-medium text-gray-900">{user.name}</p>
                                        <p className="text-xs text-gray-600">{user.email}</p>
                                    </button>
                                ))}
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowApproverModal(false)}
                                className="w-full bg-gray-200 text-gray-900 py-2 rounded hover:bg-gray-300 transition"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// ==================== APPROVER DASHBOARD ====================

function ApprovalDashboard() {
    const [pendingApprovals, setPendingApprovals] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [selectedTicket, setSelectedTicket] = React.useState(null);
    const [approvalComments, setApprovalComments] = React.useState('');

    const currentUserId = 1; // Replace with actual user ID from login

    React.useEffect(() => {
        fetchPendingApprovals();
    }, []);

    const fetchPendingApprovals = async () => {
        try {
            setLoading(true);
            const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:4000' : 'https://yahweahcare-tkt-mgmt.vercel.app';
            const response = await fetch(`${API_URL}/api/approvals/pending/${currentUserId}`);
            const data = await response.json();
            setPendingApprovals(data);
        } catch (err) {
            setError('Failed to load pending approvals');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleApprove = async (ticketId) => {
        try {
            const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:4000' : 'https://yahweahcare-tkt-mgmt.vercel.app';
            const response = await fetch(`${API_URL}/api/tickets/${ticketId}/approval`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    approver_id: currentUserId,
                    approval_status: 'Approved',
                    comments: approvalComments
                })
            });

            if (response.ok) {
                alert('✅ Ticket approved!');
                setSelectedTicket(null);
                setApprovalComments('');
                fetchPendingApprovals();
            }
        } catch (err) {
            alert('Error approving ticket');
            console.error(err);
        }
    };

    const handleReject = async (ticketId) => {
        if (!approvalComments.trim()) {
            alert('Please provide a rejection reason');
            return;
        }

        try {
            const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:4000' : 'https://yahweahcare-tkt-mgmt.vercel.app';
            const response = await fetch(`${API_URL}/api/tickets/${ticketId}/approval`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    approver_id: currentUserId,
                    approval_status: 'Rejected',
                    comments: approvalComments
                })
            });

            if (response.ok) {
                alert('✅ Ticket rejected and reopened');
                setSelectedTicket(null);
                setApprovalComments('');
                fetchPendingApprovals();
            }
        } catch (err) {
            alert('Error rejecting ticket');
            console.error(err);
        }
    };

    return (
        <main className="flex-1 overflow-auto bg-gray-50">
            <div className="p-8">
                <div className="mb-8">
                    <h1 className="text-4xl font-bold text-gray-900 mb-2">👨‍⚖️ Approval Dashboard</h1>
                    <p className="text-gray-600">Review and approve pending tickets</p>
                </div>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className="text-center py-12">
                        <p>Loading pending approvals...</p>
                    </div>
                ) : pendingApprovals.length === 0 ? (
                    <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
                        <p className="text-gray-600">No pending approvals</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {pendingApprovals.map(ticket => (
                            <div
                                key={ticket.id}
                                className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition cursor-pointer"
                                onClick={() => setSelectedTicket(ticket)}
                            >
                                <div className="flex justify-between items-start">
                                    <div className="flex-1">
                                        <h3 className="font-bold text-gray-900">{ticket.title}</h3>
                                        <p className="text-sm text-gray-600 mt-1">{ticket.resolution_summary}</p>
                                        <div className="flex gap-4 mt-3 text-xs text-gray-600">
                                            <span>📌 {ticket.created_by_name}</span>
                                            <span>👤 {ticket.assigned_to_name}</span>
                                            <span>⚡ {ticket.priority_label}</span>
                                        </div>
                                    </div>
                                    <div className="text-right ml-4">
                                        <span className="inline-block bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-semibold">
                                            Pending Approval
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Approval Modal */}
            {selectedTicket && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-8 max-w-2xl w-full mx-4">
                        <h2 className="text-2xl font-bold text-gray-900 mb-4">{selectedTicket.title}</h2>

                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                            <p className="font-semibold text-gray-900 mb-2">Resolution Summary:</p>
                            <p className="text-gray-700">{selectedTicket.resolution_summary}</p>
                        </div>

                        <div className="mb-6">
                            <label className="block text-sm font-medium text-gray-900 mb-2">Your Comments/Justification *</label>
                            <textarea
                                value={approvalComments}
                                onChange={(e) => setApprovalComments(e.target.value)}
                                placeholder="Enter approval comments or rejection reason..."
                                className="w-full h-24 border border-gray-300 rounded px-3 py-2"
                            />
                        </div>

                        <div className="flex gap-4">
                            <button
                                onClick={() => handleApprove(selectedTicket.id)}
                                className="flex-1 bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition"
                            >
                                ✅ Approve
                            </button>
                            <button
                                onClick={() => handleReject(selectedTicket.id)}
                                className="flex-1 bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700 transition"
                            >
                                ❌ Reject & Reopen
                            </button>
                            <button
                                onClick={() => {
                                    setSelectedTicket(null);
                                    setApprovalComments('');
                                }}
                                className="flex-1 bg-gray-200 text-gray-900 py-3 rounded-lg font-semibold hover:bg-gray-300 transition"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
        </main>
    );
}
