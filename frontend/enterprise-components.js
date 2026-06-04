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

