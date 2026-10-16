document.getElementById('back').addEventListener('click', () => window.gravityAccount.back());
const reloadBtn = document.getElementById('reload');
if (reloadBtn) reloadBtn.addEventListener('click', () => window.gravityAccount.reload());
window.gravityAccount.onStatus(state => {
  document.getElementById('status').textContent = state.message;
  if (state.origin) document.getElementById('origin').textContent = state.origin;
});
