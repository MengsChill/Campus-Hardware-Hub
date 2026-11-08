/* ============================================================
   Campus Hardware Hub – Dashboard JS
   ============================================================ */

const SAMPLE_TOOLS = [
  { id: 1, name: 'Digital Multimeter', category: 'electrical', catName: 'Electrical', qty: 5, icon: 'fa-bolt' },
  { id: 2, name: 'Soldering Station Kit', category: 'electrical', catName: 'Electrical', qty: 3, icon: 'fa-fire' },
  { id: 3, name: 'Cordless Power Drill', category: 'mechanical', catName: 'Mechanical', qty: 2, icon: 'fa-screwdriver' },
  { id: 4, name: 'Torque Wrench Set', category: 'mechanical', catName: 'Mechanical', qty: 4, icon: 'fa-wrench' },
  { id: 5, name: 'Digital Caliper 150mm', category: 'measuring', catName: 'Measuring', qty: 6, icon: 'fa-ruler-combined' },
  { id: 6, name: 'Laser Distance Meter', category: 'measuring', catName: 'Measuring', qty: 3, icon: 'fa-bullseye' },
  { id: 7, name: 'Raspberry Pi 4 Model B', category: 'computing', catName: 'Computing', qty: 8, icon: 'fa-microchip' },
  { id: 8, name: 'Arduino Mega 2560 Starter', category: 'computing', catName: 'Computing', qty: 10, icon: 'fa-robot' },
];

const SAMPLE_LOANS = [
  { id: 'L-2026-081', tool: 'Digital Multimeter', cat: 'Electrical', borrowDate: '02 Nov 2026', dueDate: '09 Nov 2026', status: 'Due Soon', badgeClass: 'badge-orange', icon: 'fa-bolt' },
  { id: 'L-2026-079', tool: 'Cordless Power Drill', cat: 'Mechanical', borrowDate: '28 Oct 2026', dueDate: '12 Nov 2026', status: 'Active', badgeClass: 'badge-blue', icon: 'fa-screwdriver' },
];

const NOTIFICATIONS = [
  { title: 'Loan Due Reminder', body: 'Digital Multimeter is due tomorrow at 5:00 PM.', time: '2 hours ago', icon: 'fa-clock', unread: true },
  { title: 'Booking Approved', body: 'Your request for Cordless Power Drill has been approved.', time: '3 days ago', icon: 'fa-circle-check', unread: false },
  { title: 'System Notice', body: 'Hardware Lab will close early this Friday for maintenance.', time: '5 days ago', icon: 'fa-triangle-exclamation', unread: false },
];

const ACTIVITIES = [
  { text: 'Borrowed Digital Multimeter', time: '02 Nov 2026, 10:30 AM' },
  { text: 'Returned Arduino Starter Kit on time', time: '30 Oct 2026, 04:15 PM' },
  { text: 'Booking confirmed for Cordless Power Drill', time: '28 Oct 2026, 02:00 PM' },
];

document.addEventListener('DOMContentLoaded', () => {
  initUser();
  renderStats();
  renderLoansTable();
  renderToolsGrid('all');
  renderDueSoon();
  renderNotifications();
  renderActivities();
});

function initUser() {
  const saved = sessionStorage.getItem('chh_user');
  if (saved) {
    try {
      const user = JSON.parse(saved);
      const email = user.email || '';
      const namePart = email.split('@')[0].replace(/[._]/g, ' ');
      const formattedName = namePart ? namePart.charAt(0).toUpperCase() + namePart.slice(1) : 'Student';
      
      const welcomeName = document.getElementById('welcomeName');
      const topbarName = document.getElementById('topbarUserName');
      const topbarRole = document.getElementById('topbarUserRole');
      const avatar = document.getElementById('userAvatar');

      if (welcomeName) welcomeName.textContent = formattedName;
      if (topbarName) topbarName.textContent = formattedName;
      if (avatar) avatar.textContent = formattedName.charAt(0).toUpperCase();

      if (user.role === 'admin') {
        if (topbarRole) topbarRole.textContent = 'Admin';
        document.body.classList.add('role-admin');
      } else {
        if (topbarRole) topbarRole.textContent = 'Student';
      }
    } catch (e) {
      console.warn('Could not parse user session:', e);
    }
  }
}

function renderStats() {
  animateCounter('stat-tools', 128);
  animateCounter('stat-active', 2);
  animateCounter('stat-overdue', 0);
  animateCounter('stat-returned', 7);
}

function animateCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  let current = 0;
  const step = Math.max(1, Math.floor(target / 20));
  const timer = setInterval(() => {
    current += step;
    if (current >= target) {
      el.textContent = target;
      clearInterval(timer);
    } else {
      el.textContent = current;
    }
  }, 30);
}

function renderLoansTable() {
  const tbody = document.getElementById('loansTableBody');
  const empty = document.getElementById('loansEmpty');
  if (!tbody) return;

  if (SAMPLE_LOANS.length === 0) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  tbody.innerHTML = SAMPLE_LOANS.map(item => `
    <tr>
      <td>
        <div class="tool-cell">
          <div class="tool-thumb"><i class="fa-solid ${item.icon}"></i></div>
          <div>
            <div class="tool-name">${item.tool}</div>
            <div class="tool-category">${item.cat}</div>
          </div>
        </div>
      </td>
      <td class="loan-id">${item.id}</td>
      <td class="date-cell">${item.borrowDate}</td>
      <td class="date-cell"><strong>${item.dueDate}</strong></td>
      <td><span class="badge ${item.badgeClass}"><i class="fa-solid fa-circle"></i> ${item.status}</span></td>
      <td>
        <button class="btn-return" onclick="returnTool('${item.id}', '${item.tool}')">Return</button>
      </td>
    </tr>
  `).join('');
}

function renderToolsGrid(category) {
  const grid = document.getElementById('toolsGrid');
  if (!grid) return;

  const filtered = category === 'all'
    ? SAMPLE_TOOLS
    : SAMPLE_TOOLS.filter(t => t.category === category);

  grid.innerHTML = filtered.map(t => `
    <div class="tool-card" onclick="quickBorrow('${t.name}')">
      <div class="tool-card-icon" style="background: var(--blue-pale); color: var(--blue-primary);">
        <i class="fa-solid ${t.icon}"></i>
      </div>
      <div class="tool-card-name">${t.name}</div>
      <div class="tool-card-cat">${t.catName}</div>
      <div class="tool-card-footer">
        <div class="tool-card-qty">Available: <span>${t.qty}</span></div>
        <button class="btn-borrow" onclick="event.stopPropagation(); quickBorrow('${t.name}')">Borrow</button>
      </div>
    </div>
  `).join('');
}

function filterTools(btn) {
  document.querySelectorAll('#catalogFilter .filter-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const cat = btn.getAttribute('data-cat');
  renderToolsGrid(cat);
}

function renderDueSoon() {
  const container = document.getElementById('dueSoonList');
  if (!container) return;

  container.innerHTML = `
    <div class="due-item urgent">
      <div class="due-item-icon"><i class="fa-solid fa-bolt" style="color:#DC2626;"></i></div>
      <div class="due-item-info">
        <div class="due-item-name">Digital Multimeter</div>
        <div class="due-item-date">Due: Tomorrow, 5:00 PM</div>
      </div>
      <div class="due-item-days">1 day left</div>
    </div>
    <div class="due-item warning">
      <div class="due-item-icon"><i class="fa-solid fa-screwdriver" style="color:#D97706;"></i></div>
      <div class="due-item-info">
        <div class="due-item-name">Cordless Power Drill</div>
        <div class="due-item-date">Due: 12 Nov 2026</div>
      </div>
      <div class="due-item-days">4 days left</div>
    </div>
  `;
}

function renderNotifications() {
  const list = document.getElementById('notifList');
  if (!list) return;

  list.innerHTML = NOTIFICATIONS.map(n => `
    <div class="notif-item ${n.unread ? 'unread' : ''}">
      <div class="notif-icon" style="background:var(--blue-pale); color:var(--blue-primary);">
        <i class="fa-solid ${n.icon}"></i>
      </div>
      <div class="notif-info">
        <div class="notif-title">${n.title}</div>
        <div class="notif-body">${n.body}</div>
        <div class="notif-time">${n.time}</div>
      </div>
    </div>
  `).join('');
}

function renderActivities() {
  const feed = document.getElementById('activityFeed');
  if (!feed) return;

  feed.innerHTML = ACTIVITIES.map(a => `
    <div class="activity-item">
      <div class="activity-dot"></div>
      <div class="activity-info">
        <div class="act-text">${a.text}</div>
        <div class="act-time">${a.time}</div>
      </div>
    </div>
  `).join('');
}

/* ── UI Controls ──────────────────────────────────── */
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar) sidebar.classList.toggle('open');
  if (overlay) overlay.classList.toggle('open');
}

function toggleUserMenu() {
  const menu = document.getElementById('userMenu');
  if (menu) menu.classList.toggle('open');
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('userMenu');
  if (menu && !menu.contains(e.target)) {
    menu.classList.remove('open');
  }
});

function confirmLogout() {
  const modal = document.getElementById('logoutModal');
  if (modal) modal.classList.add('open');
}

function closeLogoutModal() {
  const modal = document.getElementById('logoutModal');
  if (modal) modal.classList.remove('open');
}

function doLogout() {
  sessionStorage.removeItem('chh_user');
  window.location.href = 'login.html';
}

function returnTool(id, toolName) {
  if (typeof showToast === 'function') {
    showToast(`Return request submitted for ${toolName} (${id})`, 'success');
  }
}

function quickBorrow(toolName) {
  if (typeof showToast === 'function') {
    showToast(`Booking initiated for ${toolName}`, 'default');
  }
}

function markAllRead() {
  document.querySelectorAll('.notif-item.unread').forEach(el => el.classList.remove('unread'));
  const badge = document.getElementById('topbarNotifBadge');
  if (badge) badge.style.display = 'none';
  if (typeof showToast === 'function') showToast('All notifications marked as read', 'default');
}

function liveSearch(val) {
  const dd = document.getElementById('searchDropdown');
  if (!dd) return;
  const q = val.trim().toLowerCase();
  if (!q) { dd.classList.remove('open'); return; }

  const matches = SAMPLE_TOOLS.filter(t => t.name.toLowerCase().includes(q) || t.catName.toLowerCase().includes(q));
  if (matches.length === 0) {
    dd.innerHTML = `<div style="padding:10px 14px; font-size:12px; color:var(--gray-400);">No matching tools found</div>`;
  } else {
    dd.innerHTML = matches.map(m => `
      <div class="search-result-item" onclick="quickBorrow('${m.name}'); document.getElementById('searchDropdown').classList.remove('open');">
        <i class="fa-solid ${m.icon}"></i>
        <span>${m.name}</span>
        <span style="margin-left:auto; font-size:11px; color:var(--gray-400);">${m.catName}</span>
      </div>
    `).join('');
  }
  dd.classList.add('open');
}

