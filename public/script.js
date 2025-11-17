// script.js — client-side logic for the Telegram Web App

(function(){
  const Telegram = window.Telegram ? window.Telegram.WebApp : null;
  if (Telegram) Telegram.ready();

  const modalsContainer = document.getElementById('modals');
  const btnShowAll = document.getElementById('btnShowAll');
  const btnClose = document.getElementById('btnClose');
  const greeting = document.getElementById('greeting');

  // Safe access to user info provided by Telegram Web App
  const webUser = (Telegram && Telegram.initDataUnsafe && Telegram.initDataUnsafe.user) ? Telegram.initDataUnsafe.user : null;
  const userId = webUser ? webUser.id : 'مهمان';
  const fullname = webUser ? ([webUser.first_name, webUser.last_name].filter(Boolean).join(' ')) : 'مهمان';

  // Update greeting
  greeting.textContent = fullname === 'مهمان' ? 'سلام!' : `سلام، ${webUser.first_name} 👋`;

  // Handlers
  btnShowAll.addEventListener('click', () => {
    showUserModal();
    setTimeout(showDateModal, 700);
    setTimeout(showTimeModal, 1400);
  });

  btnClose.addEventListener('click', () => {
    if (Telegram) Telegram.close();
    else alert('این وب‌اپ در داخل تلگرام باز نشده است.');
  });

  // Create and show modals
  function showUserModal(){
    const m = createModal('اطلاعات کاربری', `شناسه کاربری: ${userId}`, [`نام کامل: ${fullname}`]);
    modalsContainer.appendChild(m);
  }

  function showDateModal(){
    const now = new Date();
    const jalali = gregorianToJalali(now.getFullYear(), now.getMonth()+1, now.getDate());
    const dateStr = `${jalali.jy}/${pad(jalali.jm)}/${pad(jalali.jd)}`;
    const m = createModal('تاریخ امروز (شمسی)', dateStr, [formatLongJalali(jalali)]);
    modalsContainer.appendChild(m);
  }

  function showTimeModal(){
    const now = new Date();
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const m = createModal('ساعت فعلی', timeStr, [new Date().toLocaleString('fa-IR')], true);
    modalsContainer.appendChild(m);
  }

  function createModal(title, main, lines = [], dismissable = true){
    const wrap = document.createElement('div');
    wrap.className = 'modal';

    const h = document.createElement('h3'); h.textContent = title; wrap.appendChild(h);
    const p = document.createElement('p'); p.textContent = main; wrap.appendChild(p);

    if (lines.length){
      const meta = document.createElement('div'); meta.className = 'meta';
      lines.forEach(l => {
        const c = document.createElement('div'); c.className = 'chip small'; c.textContent = l; meta.appendChild(c);
      });
      wrap.appendChild(meta);
    }

    if (dismissable){
      const closeWrap = document.createElement('div'); closeWrap.className = 'close';
      const closeBtn = document.createElement('button'); closeBtn.className = 'btn ghost'; closeBtn.textContent = 'بستن';
      closeBtn.addEventListener('click', () => wrap.remove());
      closeWrap.appendChild(closeBtn); wrap.appendChild(closeWrap);
    }

    return wrap;
  }

  function pad(n){ return n.toString().padStart(2,'0'); }

  // Gregorian to Jalali conversion (source: public-domain algorithm)
  function div(a,b){ return Math.floor(a/b); }
  function gregorianToJalali(gy,gm,gd){
    var g_d_m=[0,31,59,90,120,151,181,212,243,273,304,334];
    var jy = (gy<=1600)?0:979;
    gy -= (gy<=1600)?621:1600;
    var gy2 = (gm>2)?(gy+1):gy;
    var days = 365*gy + div((gy2+3),4) - div((gy2+99),100) + div((gy2+399),400) - 80 + gd + g_d_m[gm-1];
    jy += 33*div(days,12053);
    days %= 12053;
    jy += 4*div(days,1461);
    days %= 1461;
    jy += div(days-1,365);
    if (days > 365) days = (days-1)%365;
    var jm = (days < 186)?1+div(days,31):7+div(days-186,30);
    var jd = 1 + ((days < 186)?(days%31):( (days-186)%30 ));
    return { jy: jy, jm: jm, jd: jd };
  }

  function formatLongJalali(j){
    const months = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
    return `${j.jd} ${months[j.jm-1]} ${j.jy}`;
  }

})();
