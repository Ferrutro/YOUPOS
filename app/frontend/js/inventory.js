import { api, requireAuth, requireRole, toast, formatMoney } from './api.js';
import { renderLayout } from './layout.js';

if (!requireAuth()) throw new Error('no auth');
if (!requireRole('admin', 'manager')) throw new Error('no role');

const main = renderLayout('/inventory.html');

let products = [];
let categories = [];
let settings = {};
let activeTab = 'products';

main.innerHTML = `
  <div class="page-header">
    <h1>Inventario</h1>
    <div class="flex gap-8">
      <button id="new-category-btn">+ Categoría</button>
      <button class="primary" id="new-product-btn">+ Producto</button>
    </div>
  </div>

  <div class="tabs">
    <button data-tab="products" class="active">Productos</button>
    <button data-tab="low-stock">Stock bajo</button>
    <button data-tab="categories">Categorías</button>
  </div>

  <div class="card">
    <input type="text" id="search-input" placeholder="Buscar por nombre, SKU o código de barras…" style="max-width:360px; margin-bottom:14px;" />
    <div id="tab-content"></div>
  </div>
`;

const tabContent = document.getElementById('tab-content');
const searchInput = document.getElementById('search-input');

document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;
    searchInput.style.display = activeTab === 'categories' ? 'none' : '';
    render();
  });
});

searchInput.addEventListener('input', render);

async function loadAll() {
  try {
    const [productsRes, categoriesRes, settingsRes] = await Promise.all([
      api.get('/api/products?active=false'), // active=false = sin filtrar por estado (trae activos e inactivos)
      api.get('/api/categories'),
      api.get('/api/settings'),
    ]);
    products = productsRes.products;
    categories = categoriesRes.categories;
    settings = settingsRes.settings;
    render();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function categoryName(id) {
  const c = categories.find((c) => c.id === id);
  return c ? c.name : '—';
}

function render() {
  if (activeTab === 'products') renderProductsTable(products);
  else if (activeTab === 'low-stock') renderLowStock();
  else renderCategoriesTable();
}

function filterBySearch(list) {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (p) => p.name.toLowerCase().includes(q) || (p.sku && p.sku.toLowerCase().includes(q)) || (p.barcode && p.barcode.toLowerCase().includes(q))
  );
}

function renderProductsTable(list) {
  const filtered = filterBySearch(list);
  if (filtered.length === 0) {
    tabContent.innerHTML = '<div class="empty-state">No hay productos.</div>';
    return;
  }
  tabContent.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Producto</th><th>Categoría</th><th class="num">Costo</th><th class="num">Precio</th>
          <th class="num">Stock</th><th>Estado</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${filtered
          .map(
            (p) => `
          <tr>
            <td>
              <div class="flex gap-8" style="align-items:center;">
                <div style="width:34px; height:34px; border-radius:6px; overflow:hidden; flex-shrink:0; background:var(--page-plane); border:1px solid var(--border); display:flex; align-items:center; justify-content:center;">
                  ${p.image_data ? `<img src="${p.image_data}" style="width:100%; height:100%; object-fit:cover;" />` : ''}
                </div>
                <div><strong>${p.name}</strong><br><span class="text-muted" style="font-size:12px">${p.sku || ''} ${p.barcode ? '· ' + p.barcode : ''}</span></div>
              </div>
            </td>
            <td>${categoryName(p.category_id)}</td>
            <td class="num">${formatMoney(p.cost_price, settings.currency)}</td>
            <td class="num">${formatMoney(p.sale_price, settings.currency)}</td>
            <td class="num">${p.track_stock ? p.stock_qty : '—'}</td>
            <td>${p.active ? '<span class="badge good">Activo</span>' : '<span class="badge muted">Inactivo</span>'}
              ${p.track_stock && p.stock_qty <= p.min_stock ? '<span class="badge warning">Stock bajo</span>' : ''}
            </td>
            <td class="flex gap-8">
              <button class="ghost" data-action="adjust" data-id="${p.id}">Ajustar stock</button>
              <button class="ghost" data-action="edit" data-id="${p.id}">Editar</button>
              ${p.active
                ? `<button class="ghost" data-action="delete" data-id="${p.id}">Desactivar</button>`
                : `<button class="ghost" data-action="reactivate" data-id="${p.id}">Reactivar</button>`}
              <button class="ghost" data-action="delete-permanent" data-id="${p.id}" data-name="${p.name}">Eliminar</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;
  bindProductActions();
}

function renderLowStock() {
  const list = products.filter((p) => p.active && p.track_stock && p.stock_qty <= p.min_stock);
  if (list.length === 0) {
    tabContent.innerHTML = '<div class="empty-state">No hay productos con stock bajo. 🎉</div>';
    return;
  }
  renderProductsTable(list);
}

function renderCategoriesTable() {
  if (categories.length === 0) {
    tabContent.innerHTML = '<div class="empty-state">No hay categorías.</div>';
    return;
  }
  tabContent.innerHTML = `
    <table>
      <thead><tr><th>Nombre</th><th>Productos</th><th></th></tr></thead>
      <tbody>
        ${categories
          .map(
            (c) => `
          <tr>
            <td>
              <div class="flex gap-8" style="align-items:center;">
                ${c.color ? `<span style="display:inline-block; width:12px; height:12px; border-radius:50%; background:${c.color}; flex-shrink:0;"></span>` : ''}
                <span>${c.name}</span>
              </div>
            </td>
            <td>${products.filter((p) => p.category_id === c.id).length}</td>
            <td class="flex gap-8">
              <button class="ghost" data-action="edit-cat" data-id="${c.id}">Editar</button>
              <button class="ghost" data-action="delete-cat" data-id="${c.id}">Eliminar</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;
  tabContent.querySelectorAll('button[data-action="edit-cat"]').forEach((btn) =>
    btn.addEventListener('click', () => categoryModal(categories.find((c) => c.id === Number(btn.dataset.id))))
  );
  tabContent.querySelectorAll('button[data-action="delete-cat"]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta categoría?')) return;
      try {
        await api.delete(`/api/categories/${btn.dataset.id}`);
        toast('Categoría eliminada.', 'success');
        loadAll();
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
}

function bindProductActions() {
  tabContent.querySelectorAll('button[data-action="edit"]').forEach((btn) =>
    btn.addEventListener('click', () => productModal(products.find((p) => p.id === Number(btn.dataset.id))))
  );
  tabContent.querySelectorAll('button[data-action="adjust"]').forEach((btn) =>
    btn.addEventListener('click', () => adjustStockModal(products.find((p) => p.id === Number(btn.dataset.id))))
  );
  tabContent.querySelectorAll('button[data-action="delete"]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('¿Desactivar este producto? Ya no aparecerá en el punto de venta.')) return;
      try {
        await api.delete(`/api/products/${btn.dataset.id}`);
        toast('Producto desactivado.', 'success');
        loadAll();
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
  tabContent.querySelectorAll('button[data-action="reactivate"]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        await api.put(`/api/products/${btn.dataset.id}`, { active: true });
        toast('Producto reactivado.', 'success');
        loadAll();
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
  tabContent.querySelectorAll('button[data-action="delete-permanent"]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar "${btn.dataset.name}" para siempre? Esto no se puede deshacer. Las ventas ya registradas con este producto no se ven afectadas, pero el producto desaparece por completo del inventario.`)) return;
      try {
        await api.delete(`/api/products/${btn.dataset.id}/permanent`);
        toast('Producto eliminado.', 'success');
        loadAll();
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
}

document.getElementById('new-product-btn').addEventListener('click', () => productModal(null));
document.getElementById('new-category-btn').addEventListener('click', () => categoryModal(null));

function productModal(product) {
  const isEdit = !!product;
  let imageDataValue = product?.image_data || null;
  let colorValue = product?.color || null;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? 'Editar producto' : 'Nuevo producto'}</h3>
      <div class="field">
        <label>Imagen del producto</label>
        <div style="display:flex; align-items:center; gap:12px;">
          <div id="image-preview" style="width:64px; height:64px; border-radius:8px; border:1px solid var(--border); background:var(--page-plane); display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0;">
            ${imageDataValue ? `<img src="${imageDataValue}" style="width:100%; height:100%; object-fit:cover;" />` : '<span class="text-muted" style="font-size:11px;">Sin imagen</span>'}
          </div>
          <input type="file" accept="image/*" id="f-image" style="display:none;" />
          <button type="button" class="ghost" id="pick-image-btn">Subir imagen</button>
          <button type="button" class="ghost" id="remove-image-btn" style="${imageDataValue ? '' : 'display:none;'}">Quitar</button>
        </div>
      </div>
      <div class="field">
        <label>Color de la tarjeta (opcional, se ve en la pantalla de venta)</label>
        <div class="flex gap-8" style="align-items:center;">
          <input type="color" id="f-color" value="${colorValue || '#2a6ef5'}" style="height:38px; width:56px; padding:3px; cursor:pointer;" />
          <button type="button" class="ghost" id="remove-color-btn" style="${colorValue ? '' : 'display:none;'}">Quitar color</button>
          <span class="text-muted" style="font-size:11.5px;">Si no le pones uno, usa el color de su categoría (si tiene).</span>
        </div>
      </div>
      <div class="field"><label>Nombre</label><input id="f-name" value="${product?.name || ''}" /></div>
      <div class="grid grid-2">
        <div class="field"><label>SKU</label><input id="f-sku" value="${product?.sku || ''}" /></div>
        <div class="field"><label>Código de barras</label><input id="f-barcode" value="${product?.barcode || ''}" /></div>
      </div>
      <div class="field">
        <label>Categoría</label>
        <select id="f-category">
          <option value="">Sin categoría</option>
          ${categories.map((c) => `<option value="${c.id}" ${product?.category_id === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
        </select>
      </div>
      <div class="grid grid-3">
        <div class="field"><label>Costo</label><input type="number" step="0.01" id="f-cost" value="${product?.cost_price ?? 0}" /></div>
        <div class="field"><label>Precio de venta</label><input type="number" step="0.01" id="f-price" value="${product?.sale_price ?? 0}" /></div>
        <div class="field"><label>Impuesto %</label><input type="number" step="0.01" id="f-tax" value="${product?.tax_rate ?? 0}" /></div>
      </div>
      <div class="grid grid-3">
        <div class="field"><label>${isEdit ? 'Stock actual (solo lectura)' : 'Stock inicial'}</label><input type="number" step="0.01" id="f-stock" value="${product?.stock_qty ?? 0}" ${isEdit ? 'disabled' : ''} /></div>
        <div class="field">
          <label>Stock mínimo</label>
          <input type="number" step="0.01" id="f-min-stock" value="${product?.min_stock ?? 0}" />
          <small class="text-secondary" style="display:block; margin-top:4px;">Cuando llegue a este número (o menos), este producto cuenta para la alerta de "stock bajo".</small>
        </div>
        <div class="field"><label>Unidad</label><input id="f-unit" value="${product?.unit || 'pza'}" /></div>
      </div>
      <div class="field">
        <label><input type="checkbox" id="f-track-stock" style="width:auto" ${product?.track_stock !== false ? 'checked' : ''} /> Controlar inventario</label>
      </div>
      <div class="modal-actions">
        <button class="ghost" id="cancel-modal">Cancelar</button>
        <button class="primary" id="save-product">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#cancel-modal').addEventListener('click', () => overlay.remove());

  const fileInput = overlay.querySelector('#f-image');
  const previewEl = overlay.querySelector('#image-preview');
  const removeImageBtn = overlay.querySelector('#remove-image-btn');
  overlay.querySelector('#pick-image-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Selecciona un archivo de imagen.', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Se reduce a máximo 400px de lado y se comprime a JPEG para no
        // inflar la base de datos con imágenes pesadas.
        const MAX = 400;
        let { width, height } = img;
        if (width > height && width > MAX) { height = Math.round(height * (MAX / width)); width = MAX; }
        else if (height >= width && height > MAX) { width = Math.round(width * (MAX / height)); height = MAX; }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        imageDataValue = canvas.toDataURL('image/jpeg', 0.82);
        previewEl.innerHTML = `<img src="${imageDataValue}" style="width:100%; height:100%; object-fit:cover;" />`;
        removeImageBtn.style.display = '';
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
  removeImageBtn.addEventListener('click', () => {
    imageDataValue = null;
    previewEl.innerHTML = '<span class="text-muted" style="font-size:11px;">Sin imagen</span>';
    removeImageBtn.style.display = 'none';
    fileInput.value = '';
  });

  const colorInput = overlay.querySelector('#f-color');
  const removeColorBtn = overlay.querySelector('#remove-color-btn');
  colorInput.addEventListener('input', () => {
    colorValue = colorInput.value;
    removeColorBtn.style.display = '';
  });
  removeColorBtn.addEventListener('click', () => {
    colorValue = null;
    colorInput.value = '#2a6ef5';
    removeColorBtn.style.display = 'none';
  });

  overlay.querySelector('#save-product').addEventListener('click', async () => {
    const body = {
      name: overlay.querySelector('#f-name').value.trim(),
      sku: overlay.querySelector('#f-sku').value.trim() || null,
      barcode: overlay.querySelector('#f-barcode').value.trim() || null,
      category_id: overlay.querySelector('#f-category').value || null,
      cost_price: Number(overlay.querySelector('#f-cost').value || 0),
      sale_price: Number(overlay.querySelector('#f-price').value || 0),
      tax_rate: Number(overlay.querySelector('#f-tax').value || 0),
      min_stock: Number(overlay.querySelector('#f-min-stock').value || 0),
      unit: overlay.querySelector('#f-unit').value.trim() || 'pza',
      track_stock: overlay.querySelector('#f-track-stock').checked,
      image_data: imageDataValue,
      color: colorValue,
    };
    if (!isEdit) body.stock_qty = Number(overlay.querySelector('#f-stock').value || 0);
    if (!body.name) { toast('El nombre es requerido.', 'error'); return; }
    try {
      if (isEdit) await api.put(`/api/products/${product.id}`, body);
      else await api.post('/api/products', body);
      toast('Producto guardado.', 'success');
      overlay.remove();
      loadAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function adjustStockModal(product) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Ajustar stock — ${product.name}</h3>
      <p class="text-secondary">Stock actual: <strong>${product.stock_qty} ${product.unit}</strong></p>
      <div class="field">
        <label>Cantidad a sumar (usa negativo para restar)</label>
        <input type="number" step="0.01" id="f-qty-change" value="0" />
      </div>
      <div class="field"><label>Nota</label><input id="f-note" placeholder="Motivo del ajuste" /></div>
      <div class="modal-actions">
        <button class="ghost" id="cancel-modal">Cancelar</button>
        <button class="primary" id="save-adjust">Guardar ajuste</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#cancel-modal').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#save-adjust').addEventListener('click', async () => {
    const qtyChange = Number(overlay.querySelector('#f-qty-change').value || 0);
    if (!qtyChange) { toast('Ingresa una cantidad distinta de cero.', 'error'); return; }
    try {
      await api.post(`/api/products/${product.id}/adjust-stock`, { qty_change: qtyChange, note: overlay.querySelector('#f-note').value });
      toast('Stock actualizado.', 'success');
      overlay.remove();
      loadAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function categoryModal(category) {
  const isEdit = !!category;
  let colorValue = category?.color || null;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? 'Editar categoría' : 'Nueva categoría'}</h3>
      <div class="field"><label>Nombre</label><input id="f-cat-name" value="${category?.name || ''}" /></div>
      <div class="field">
        <label>Color (opcional, se ve en la pantalla de venta)</label>
        <div class="flex gap-8" style="align-items:center;">
          <input type="color" id="f-cat-color" value="${colorValue || '#2a6ef5'}" style="height:38px; width:56px; padding:3px; cursor:pointer;" />
          <button type="button" class="ghost" id="remove-cat-color" style="${colorValue ? '' : 'display:none;'}">Quitar color</button>
        </div>
      </div>
      <div class="modal-actions">
        <button class="ghost" id="cancel-modal">Cancelar</button>
        <button class="primary" id="save-cat">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#cancel-modal').addEventListener('click', () => overlay.remove());

  const colorInput = overlay.querySelector('#f-cat-color');
  const removeColorBtn = overlay.querySelector('#remove-cat-color');
  colorInput.addEventListener('input', () => {
    colorValue = colorInput.value;
    removeColorBtn.style.display = '';
  });
  removeColorBtn.addEventListener('click', () => {
    colorValue = null;
    colorInput.value = '#2a6ef5';
    removeColorBtn.style.display = 'none';
  });

  overlay.querySelector('#save-cat').addEventListener('click', async () => {
    const name = overlay.querySelector('#f-cat-name').value.trim();
    if (!name) { toast('El nombre es requerido.', 'error'); return; }
    try {
      if (isEdit) await api.put(`/api/categories/${category.id}`, { name, color: colorValue });
      else await api.post('/api/categories', { name, color: colorValue });
      toast('Categoría guardada.', 'success');
      overlay.remove();
      loadAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

loadAll();
