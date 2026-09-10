const TAXONOMY_URLS = ['./product-taxonomy.json', './auto-parts-taxonomy.json', './digital-download-taxonomy.json'];

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

function subcategories(category = {}) {
  return (category.subcategories || []).map((item) => typeof item === 'string'
    ? { id: item, label: item }
    : { id: item?.id || item?.label || '', label: item?.label || item?.name || item?.id || '' }
  ).filter((item) => item.id && item.label);
}

export default class TaxonomyBrowser {
  constructor(rootId, options = {}) {
    this.root = document.getElementById(rootId);
    this.options = options;
    if (this.root) this.load();
  }

  async load() {
    const responses = await Promise.all(TAXONOMY_URLS.map((url) => fetch(url, { cache: 'no-store' }).catch(() => null)));
    const entries = [];
    for (const response of responses) {
      const data = response?.ok ? await response.json().catch(() => null) : null;
      if (data?.id) entries.push(data);
      if (Array.isArray(data?.departments)) entries.push(...data.departments);
    }
    this.departments = [...new Map(entries.filter((item) => item?.id).map((item) => [String(item.id), item])).values()];
    this.render();
  }

  navigate(values = {}) {
    const params = new URLSearchParams();
    if (values.department) params.set('department', values.department);
    if (values.category) params.set('category', values.category);
    if (values.subcategory) params.set('subcategory', values.subcategory);
    window.location.assign(`./catalogue.html${params.toString() ? `?${params}` : ''}`);
  }

  render() {
    const department = this.departments.find((item) => String(item.id) === String(this.options.initialDepartment));
    if (!department) { this.root.innerHTML = ''; return; }
    const categories = Array.isArray(department.categories) ? department.categories : [];
    this.root.innerHTML = `<section class="taxonomy-browser"><button class="taxonomy-back" type="button" data-all><i class="fas fa-arrow-left"></i> Tous les départements</button><header><p>Département</p><h1>${esc(department.label || department.name)}</h1><span>${categories.length} catégories à explorer</span></header><div class="taxonomy-categories">${categories.map((category) => `<article class="taxonomy-category"><button type="button" data-category="${esc(category.id)}"><strong>${esc(category.label || category.name || category.id)}</strong><i class="fas fa-arrow-right"></i></button><div>${subcategories(category).map((sub) => `<button type="button" class="taxonomy-subcategory ${String(this.options.initialSubcategory) === String(sub.id) ? 'active' : ''}" data-category="${esc(category.id)}" data-subcategory="${esc(sub.id)}">${esc(sub.label)}</button>`).join('')}</div></article>`).join('')}</div></section>`;
    this.root.querySelector('[data-all]')?.addEventListener('click', () => this.navigate());
    this.root.querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', () => this.navigate({
      department: department.id,
      category: button.dataset.category,
      subcategory: button.dataset.subcategory || ''
    })));
  }
}
