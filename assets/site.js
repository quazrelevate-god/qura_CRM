// QURA V3, shared behaviour.
// Lead capture + the old "gate" modal now live in apply-form.js (one multi-step
// application form for every CTA). This file keeps only presentational behaviour.
(function(){
  // sticky/compacting header
  var nav=document.querySelector('header.nav');
  if(nav){
    var onScroll=function(){nav.classList.toggle('scrolled',window.scrollY>60);};
    addEventListener('scroll',onScroll);onScroll();
  }
  // scroll reveal
  var obs=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting)e.target.classList.add('in');});},{threshold:.12});
  document.querySelectorAll('.rv').forEach(function(el){obs.observe(el);});
  // seamless marquee: duplicate each row's cards once
  document.querySelectorAll('.mrow').forEach(function(r){r.innerHTML+=r.innerHTML;});

  // ===== mobile nav: inject hamburger + full-screen overlay (cloned from existing nav) =====
  if(nav){
    var srcNav=nav.querySelector('nav');
    if(srcNav){
      var burger=document.createElement('button');
      burger.className='nav-burger';burger.type='button';
      burger.setAttribute('aria-label','Open menu');burger.setAttribute('aria-expanded','false');
      burger.innerHTML='<span></span><span></span><span></span>';
      nav.appendChild(burger);

      var ov=document.createElement('div');ov.className='nav-overlay';ov.setAttribute('role','dialog');ov.setAttribute('aria-label','Menu');
      var html='',idx=1;
      srcNav.querySelectorAll('a').forEach(function(a){
        var applyEl=a.querySelector('.nav-apply');
        var href=a.getAttribute('href')||'#';
        if(applyEl){
          html+='<a class="apply" href="'+href+'">Apply Now<span class="ix">↗</span></a>';
        }else{
          var label=(a.textContent||'').trim();
          var n=('0'+idx).slice(-2);idx++;
          html+='<a href="'+href+'">'+label+'<span class="ix">'+n+'</span></a>';
        }
      });
      html+='<div class="ov-foot">QURA Film Academy · Chennai · Class of 2027</div>';
      ov.innerHTML=html;
      document.body.appendChild(ov);

      var setOpen=function(open){
        document.body.classList.toggle('menu-open',open);
        burger.setAttribute('aria-expanded',open?'true':'false');
        burger.setAttribute('aria-label',open?'Close menu':'Open menu');
      };
      burger.addEventListener('click',function(){setOpen(!document.body.classList.contains('menu-open'));});
      ov.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){setOpen(false);});});
      document.addEventListener('keydown',function(e){if(e.key==='Escape')setOpen(false);});
    }
  }
})();
