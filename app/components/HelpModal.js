import HelpTabs from './HelpTabs';

export default function HelpModal({
  isOpen,
  onClose,
  tabs,
  activeTabId,
  onSelectTab,
}) {
  if (!isOpen) return null;

  const activeTab = tabs.find(tab => tab.id === activeTabId) || tabs[0];

  return (
    <div className="modal-backdrop help-modal-backdrop" role="presentation">
      <div
        className="modal-card help-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        aria-describedby="help-modal-content"
      >
        <div className="help-modal-header">
          <h2 id="help-modal-title">Hướng dẫn sử dụng</h2>
          <button type="button" className="modal-close-button" onClick={onClose} aria-label="Đóng hướng dẫn">
            ✕
          </button>
        </div>
        <HelpTabs tabs={tabs} activeTabId={activeTab?.id} onSelectTab={onSelectTab} />
        <div className="help-modal-content" id="help-modal-content">
          {activeTab?.content}
        </div>
      </div>
    </div>
  );
}
