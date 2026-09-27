// Apply the saved colour theme before first paint to avoid a flash.
try {
  var t = localStorage.getItem('lol-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
