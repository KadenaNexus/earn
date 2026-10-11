const root = document.documentElement;

try {
  const savedTheme = localStorage.getItem('ke-theme');
  if (savedTheme === 'light' || savedTheme === 'dark') root.dataset.theme = savedTheme;
} catch {}

document.getElementById('themeBtn')?.addEventListener('click', () => {
  const currentTheme = root.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  root.dataset.theme = currentTheme === 'light' ? 'dark' : 'light';
  try {
    localStorage.setItem('ke-theme', root.dataset.theme);
  } catch {}
});
