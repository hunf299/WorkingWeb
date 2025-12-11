/* =========================================
   MODERN COMMAND BAR (Redesign Calendar Card)
   ========================================= */

/* 1. Container chính: Biến Card thành Floating Bar */
.calendar-card {
  background: var(--bg-card); /* Hoặc #ffffff */
  border: 1px solid var(--border-subtle); /* Hoặc #e2e8f0 */
  border-radius: 24px; /* Bo góc cực lớn theo trend 2025 */
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.04); /* Bóng mềm, sâu */
  margin-bottom: 32px;
  overflow: visible; /* Để shadow không bị cắt */
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
  z-index: 10;
}

.calendar-card:hover {
  box-shadow: 0 12px 40px rgba(59, 130, 246, 0.1); /* Glow nhẹ màu xanh khi hover */
  border-color: rgba(59, 130, 246, 0.3);
}

.calendar-card[data-expanded="true"] {
  border-color: var(--primary); /* Highlight viền khi đang mở cài đặt */
}

/* 2. Header: Nơi chứa Thanh tìm kiếm + Các nút hành động */
.calendar-card-header {
  padding: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: transparent;
}

/* Ẩn label "Tìm kiếm" cũ để giao diện sạch hơn (vì placeholder đã nói lên điều đó) */
.calendar-card-label {
  display: none; 
}

/* Khu vực chứa ô tìm kiếm: Chiếm hết khoảng trống còn lại */
.calendar-card-title {
  flex: 1;
  padding-right: 0; /* Reset padding cũ */
  display: flex;
  flex-direction: column;
}

.calendar-card-search {
  width: 100%;
}

.calendar-card-search-input {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
}

/* INPUT TÌM KIẾM: Phong cách chính */
.calendar-card-search-input .text-input {
  width: 100%;
  height: 52px; /* Cao hơn, dễ bấm */
  padding-left: 48px; /* Chừa chỗ cho icon kính lúp */
  padding-right: 48px; /* Chừa chỗ cho nút Xóa */
  border-radius: 16px; /* Bo góc mềm */
  background: var(--bg-input, #f3f4f6); /* Nền xám, bỏ viền */
  border: 2px solid transparent;
  font-size: 1rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

/* Giả lập icon kính lúp bằng CSS (vì không sửa được HTML) */
.calendar-card-search-input::before {
  content: '';
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z' /%3E%3C/svg%3E");
  background-repeat: no-repeat;
  pointer-events: none;
  z-index: 1;
  transition: opacity 0.2s;
}

.calendar-card-search-input .text-input:focus {
  background: #fff;
  border-color: var(--primary);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
}

.calendar-card-search-input:focus-within::before {
  opacity: 0.5; /* Mờ icon đi chút khi đang gõ */
}

/* Nút xóa (X) trong ô tìm kiếm */
.calendar-card-clear {
  position: absolute;
  right: 12px;
  height: 32px;
  padding: 0 12px;
  font-size: 0.8rem;
  font-weight: 600;
  background: rgba(0,0,0,0.05);
  border-radius: 99px;
  border: none;
}
.calendar-card-clear:hover {
  background: #ef4444;
  color: white;
}

/* 3. Actions Group: Các nút bên phải (Download, Toggle) */
.calendar-card-actions {
  position: static; /* Reset vị trí absolute cũ */
  display: flex;
  gap: 8px;
}

/* Nút Toggle (Cài đặt) & Download */
.calendar-card-action {
  width: 52px;
  height: 52px;
  border-radius: 16px; /* Vuông bo góc thay vì tròn */
  border: 1px solid var(--border-subtle, #e2e8f0);
  background: #fff;
  color: var(--text-secondary, #64748b);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.calendar-card-action:hover {
  background: var(--bg-input, #f8fafc);
  color: var(--primary);
  border-color: var(--primary);
  transform: translateY(-2px);
}

.calendar-card-toggle[aria-expanded="true"] {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
  transform: rotate(0deg); /* Không xoay, chỉ đổi màu */
}

.calendar-card-toggle .calendar-card-chevron {
  /* Thay icon chevron bằng icon bánh răng/settings tượng trưng nếu muốn, hoặc giữ nguyên */
  transition: transform 0.3s ease;
}
.calendar-card-toggle[aria-expanded="true"] .calendar-card-chevron {
  transform: rotate(180deg);
}

/* Ẩn label text của nút Download trên mobile để gọn */
.icon-button-label {
  display: none;
}
@media (min-width: 768px) {
  .icon-button-label { display: block; }
  .calendar-card-action { width: auto; padding: 0 16px; }
}

/* 4. Body: Khu vực Ngày, Số ngày & Bộ lọc (Khi mở rộng) */
.calendar-card-body {
  border-top: 1px dashed var(--border-subtle, #e2e8f0);
  padding: 16px;
  background: var(--bg-subtle, #fcfcfc);
  border-bottom-left-radius: 24px;
  border-bottom-right-radius: 24px;
  animation: slideDown 0.3s ease forwards;
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Grid Layout cho các controls */
.calendar-card-controls {
  display: grid;
  grid-template-columns: 1fr 1fr; /* Mobile: 2 cột */
  gap: 12px;
  align-items: end; /* Căn đáy để thẳng hàng với nút lọc */
}

.calendar-card-field {
  gap: 6px;
}

.calendar-card-field label {
  font-size: 0.75rem;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--text-secondary, #64748b);
  letter-spacing: 0.05em;
  margin-left: 4px;
}

/* Input Ngày & Select */
.date-input, select.date-input {
  height: 44px;
  background: #fff;
  border: 1px solid var(--border-subtle, #e2e8f0);
  border-radius: 12px;
  padding: 0 12px;
  font-weight: 600;
  color: var(--text-primary);
  width: 100%;
  cursor: pointer;
  transition: all 0.2s;
}

.date-input:hover, select.date-input:hover {
  border-color: var(--primary);
}
.date-input:focus {
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}

/* Footer (Nút Bộ lọc) - Đưa lên cùng hàng trên Desktop */
.calendar-card-footer {
  display: flex;
  margin-top: 12px; /* Mobile: cách ra 1 chút */
}

.filter-trigger {
  height: 44px;
  width: 100%;
  justify-content: center;
  border-radius: 12px;
  font-weight: 600;
  background: #fff;
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
}
.filter-trigger[data-active="true"] {
  background: rgba(59, 130, 246, 0.1);
  color: var(--primary);
  border-color: var(--primary);
}

/* =========================================
   RESPONSIVE (PC / Tablet) - The "Logical" Part
   ========================================= */
@media (min-width: 768px) {
  /* Biến phần body thành 1 hàng ngang thẳng tắp */
  .calendar-card-body {
    display: flex;
    align-items: flex-end; /* Căn đáy */
    gap: 16px;
    padding: 16px 20px 20px 20px;
  }

  .calendar-card-controls {
    display: flex; /* Dàn hàng ngang */
    flex: 1; /* Chiếm phần lớn diện tích */
    gap: 16px;
    margin-bottom: 0;
  }

  .calendar-card-field {
    flex: 1; /* Chia đều không gian */
  }

  /* Input ngày chiếm không gian lớn hơn chút */
  .calendar-card-field:first-child {
    flex: 1.5;
  }

  /* Nút bộ lọc nằm gọn bên phải */
  .calendar-card-footer {
    margin-top: 0;
    width: auto;
    flex: 0 0 auto; /* Không co giãn */
  }

  .filter-trigger {
    width: auto;
    padding: 0 24px; /* Nút rộng hơn cho đẹp */
  }
}

/* =========================================
   DARK MODE ADJUSTMENTS
   ========================================= */
@media (prefers-color-scheme: dark) {
  .calendar-card {
    background: #1e293b; /* Slate 800 */
    border-color: rgba(255,255,255,0.08);
  }
  
  .calendar-card-search-input .text-input {
    background: #0f172a; /* Slate 900 */
    color: #fff;
  }
  
  .calendar-card-action {
    background: #1e293b;
    border-color: rgba(255,255,255,0.1);
    color: #94a3b8;
  }
  .calendar-card-action:hover {
    background: #334155;
    color: #fff;
  }

  .calendar-card-body {
    background: rgba(15, 23, 42, 0.5); /* Nền tối hơn chút */
    border-top-color: rgba(255,255,255,0.08);
  }

  .date-input, select.date-input, .filter-trigger {
    background: #0f172a;
    border-color: rgba(255,255,255,0.1);
    color: #e2e8f0;
  }

  .date-input:hover, .filter-trigger:hover {
    border-color: var(--primary);
  }
}
