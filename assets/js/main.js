
(function(){
  const burger = document.querySelector('[data-burger]');
  const mobile = document.querySelector('[data-mobile]');
  if(burger && mobile){
    burger.addEventListener('click', ()=>{
      mobile.classList.toggle('open');
    });
  }

  // Reveal on scroll
  const items = document.querySelectorAll('.reveal');
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if(e.isIntersecting) e.target.classList.add('show');
    });
  }, {threshold: 0.12});
  items.forEach(el=>io.observe(el));
})();
