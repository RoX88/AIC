(() => {
  const applyBranding = () => {
    const brand = document.querySelector('.brand');
    if (!brand) return;

    brand.setAttribute('aria-label', 'AI Competence homepage');
    brand.innerHTML = `
      <img class="brand-logo" src="./assets/ai-competence-logo.png" alt="AI Competence">
      <span class="brand-section">Topic Explorer</span>`;

    if (!document.querySelector('#brand-styles')) {
      const style = document.createElement('style');
      style.id = 'brand-styles';
      style.textContent = `
        .brand{display:flex;align-items:center;gap:14px;min-width:0;font-weight:800;text-decoration:none}
        .brand-logo{display:block;width:260px;height:47px;object-fit:contain;object-position:left center;flex:0 0 auto}
        .brand-section{padding-left:14px;border-left:1px solid rgba(255,255,255,.28);font-size:.88rem;letter-spacing:.02em;white-space:nowrap;color:#d8e5f5}
        @media(max-width:760px){.brand-logo{width:190px;height:35px}.brand-section{display:none}}
        @media(max-width:430px){.brand-logo{width:160px;height:29px}.header{padding-left:14px;padding-right:14px}}
      `;
      document.head.appendChild(style);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyBranding, { once: true });
  } else {
    applyBranding();
  }
})();
