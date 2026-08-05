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
        .header{height:88px;min-height:88px;padding-top:10px;padding-bottom:10px}
        .brand{display:flex;align-items:center;gap:18px;min-width:0;font-weight:800;text-decoration:none;line-height:1}
        .brand-logo{display:block;width:340px;height:auto;max-height:64px;object-fit:contain;object-position:left center;flex:0 0 auto}
        .brand-section{display:flex;align-items:center;min-height:42px;padding-left:18px;border-left:1px solid rgba(255,255,255,.32);font-size:.95rem;letter-spacing:.02em;white-space:nowrap;color:#e2ecf8}
        @media(max-width:980px){.header nav{display:none}.brand-logo{width:300px;max-height:58px}}
        @media(max-width:760px){.header{height:80px;min-height:80px}.brand{gap:0}.brand-logo{width:255px;max-height:52px}.brand-section{display:none}}
        @media(max-width:430px){.header{height:72px;min-height:72px;padding-left:14px;padding-right:14px}.brand-logo{width:220px;max-height:46px}}
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
