import { useCallback, useEffect, useRef, useState } from 'react';

export default function HelpTabs({ tabs, activeTabId, onSelectTab }) {
  const scrollRef = useRef(null);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      setCanScrollRight(false);
      return;
    }
    setCanScrollRight(el.scrollWidth > el.clientWidth + Math.ceil(el.scrollLeft));
  }, []);

  useEffect(() => {
    updateScrollState();
  }, [tabs?.length, updateScrollState]);

  useEffect(() => {
    const handleResize = () => updateScrollState();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateScrollState]);

  const handleScrollRight = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: el.clientWidth || 240, behavior: 'smooth' });
    requestAnimationFrame(updateScrollState);
  };

  const handleScroll = () => {
    updateScrollState();
  };

  return (
    <div className="help-tabs">
      <div className="help-tabs-scroll" ref={scrollRef} onScroll={handleScroll}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`help-tab-button${tab.id === activeTabId ? ' help-tab-button--active' : ''}`}
            onClick={() => onSelectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {canScrollRight && (
        <button
          type="button"
          className="help-tabs-scroll-button"
          aria-label="Xem thêm tab hướng dẫn"
          onClick={handleScrollRight}
        >
          &gt;
        </button>
      )}
    </div>
  );
}
