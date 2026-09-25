/* QURA — CTA router. The application form now lives as its own multi-page flow
   under /apply/. This replaces the old in-page modal: every [data-gate] button
   (apply | prospectus | info) and any page marked <body data-open-form="..."> is
   routed to /apply/ with the matching intent. */
(function () {
  'use strict';
  function go(intent) {
    var i = (intent === 'prospectus' || intent === 'info') ? intent : 'apply';
    location.href = '/apply/?intent=' + i;
  }
  document.querySelectorAll('[data-gate]').forEach(function (t) {
    t.addEventListener('click', function (e) { e.preventDefault(); go(t.getAttribute('data-gate')); });
  });
  var auto = document.body.getAttribute('data-open-form');
  if (auto) go(auto);
})();
