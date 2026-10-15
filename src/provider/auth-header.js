document.getElementById('back').addEventListener('click',()=>window.gravityAccount.back());
window.gravityAccount.onStatus(state=>{
 document.getElementById('status').textContent=state.message;
 if(state.origin)document.getElementById('origin').textContent=state.origin;
});
