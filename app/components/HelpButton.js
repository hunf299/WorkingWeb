export default function HelpButton({
  onClick,
  disabled,
  variant = 'with-label',
  label = 'HDSD',
  ariaLabel = 'Hướng dẫn sử dụng',
  title = 'Hướng dẫn sử dụng',
  showTooltip,
}) {
  const isIconOnly = variant === 'icon-only';
  const shouldShowTooltip = typeof showTooltip === 'boolean' ? showTooltip : isIconOnly;
  const buttonClassName = [
    'icon-button',
    !isIconOnly ? 'icon-button--with-label' : '',
    'help-button',
    isIconOnly ? 'help-button--icon-only' : 'help-button--with-label',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`help-button-wrapper${shouldShowTooltip ? ' help-button-wrapper--tooltip' : ''}`}>
      <button
        type="button"
        className={buttonClassName}
        aria-label={ariaLabel}
        title={title}
        onClick={onClick}
        disabled={disabled}
      >
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          className="icon"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.5 9a2.5 2.5 0 114.356 1.495c-.5.623-1.075 1.013-1.411 1.376-.336.363-.445.759-.445 1.379M12 17h.01"
          />
          <circle cx="12" cy="12" r="9" />
        </svg>
        {!isIconOnly && (
          <span className="icon-button-label" aria-hidden="true">
            {label}
          </span>
        )}
      </button>
      {shouldShowTooltip && (
        <span className="help-button-tooltip" role="tooltip">
          {label}
        </span>
      )}
    </div>
  );
}
