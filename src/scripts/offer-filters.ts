const form = document.querySelector<HTMLFormElement>('[data-offer-filters]');
const results = document.querySelector<HTMLDivElement>('[data-offer-results]');
const count = document.querySelector<HTMLElement>('[data-offer-count]');
const emptyState = document.querySelector<HTMLElement>('[data-empty-results]');

if (!form || !results || !count || !emptyState) {
  throw new Error('No se pudo inicializar el filtrado de ofertas: faltan elementos de la página.');
}

const cards = [...results.querySelectorAll<HTMLElement>('.offer-card')];
const filterNames = ['q', 'category', 'store', 'price', 'discount', 'sort'] as const;

for (const name of filterNames) {
  const control = form.elements.namedItem(name);
  const value = new URLSearchParams(window.location.search).get(name);
  if (!control || value === null) continue;

  if (control instanceof HTMLSelectElement) {
    const option = [...control.options].find((item) =>
      item.value.toLocaleLowerCase('es-ES') === value.toLocaleLowerCase('es-ES')
    );
    if (option) control.value = option.value;
  } else if (control instanceof HTMLInputElement) {
    control.value = value;
  }
}

function updateUrl(): void {
  const url = new URL(window.location.href);
  for (const name of filterNames) {
    const value = new FormData(form).get(name)?.toString().trim() || '';
    if (value && value !== 'all' && !(name === 'sort' && value === 'recent')) {
      url.searchParams.set(name, value);
    } else {
      url.searchParams.delete(name);
    }
  }
  window.history.replaceState(null, '', url);
}

function applyFilters(): void {
  const values = new FormData(form);
  const query = values.get('q')?.toString().trim().toLocaleLowerCase('es-ES') || '';
  const category = values.get('category')?.toString() || 'all';
  const store = values.get('store')?.toString() || 'all';
  const rawPrice = Number(values.get('price'));
  const maxPrice = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : 0;
  const rawDiscount = Number(values.get('discount'));
  const minDiscount = Number.isFinite(rawDiscount) && rawDiscount > 0 ? rawDiscount : 0;
  const sort = values.get('sort')?.toString() || 'recent';

  const matching = cards.filter((card) => {
    const price = Number(card.dataset.price);
    const discount = Number(card.dataset.discount);
    return (!query || (card.dataset.search || '').includes(query))
      && (category === 'all' || card.dataset.category === category)
      && (store === 'all' || card.dataset.store === store)
      && (!maxPrice || price <= maxPrice)
      && (!minDiscount || discount >= minDiscount);
  });

  matching.sort((first, second) => {
    const recent = Date.parse(second.dataset.publishedAt || '') - Date.parse(first.dataset.publishedAt || '');
    if (sort === 'discount') return Number(second.dataset.discount) - Number(first.dataset.discount) || recent;
    if (sort === 'price') return Number(first.dataset.price) - Number(second.dataset.price) || recent;
    if (sort === 'featured') return Number(second.dataset.featured === 'true') - Number(first.dataset.featured === 'true') || recent;
    return recent;
  });

  for (const card of cards) card.classList.toggle('is-filtered-out', !matching.includes(card));
  for (const card of matching) results.append(card);

  count.innerHTML = `<strong>${matching.length}</strong> ${matching.length === 1 ? 'oferta activa' : 'ofertas activas'}`;
  emptyState.hidden = matching.length > 0;
  updateUrl();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  applyFilters();
});
form.addEventListener('input', applyFilters);
form.addEventListener('change', applyFilters);
applyFilters();
