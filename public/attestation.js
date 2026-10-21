document.addEventListener('DOMContentLoaded', function () {
  var btn = document.getElementById('btn-imprimer');
  if (btn) btn.addEventListener('click', function () { window.print(); });
});
