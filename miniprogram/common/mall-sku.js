function getSafeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function getSafeNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function getSafeInt(value, fallback = 0) {
  const num = Number(value)
  return Number.isInteger(num) ? num : fallback
}

function formatPrice(fen) {
  if (!fen && fen !== 0) return '0.00'
  const amount = getSafeNumber(fen, 0)
  const yuan = amount / 100

  if (yuan >= 100000000) {
    return `${(yuan / 100000000).toFixed(1).replace(/\.0$/, '')}亿`
  }
  if (yuan >= 10000) {
    return `${(yuan / 10000).toFixed(1).replace(/\.0$/, '')}万`
  }

  return yuan.toFixed(2).replace(/\.?0+$/, '') || '0'
}

function uniqueList(list) {
  const seen = new Set()
  return (list || []).filter((item) => {
    if (!item || seen.has(item)) return false
    seen.add(item)
    return true
  })
}

function normalizeSkuList(product) {
  const rawSkus = Array.isArray(product && product.skus) ? product.skus : []
  if (!rawSkus.length) return []

  return rawSkus.map((item, index) => {
    const price = Math.max(getSafeInt(item && item.price, 0), 0)
    const originalPrice = Math.max(getSafeInt(item && item.original_price, price), price)
    const stock = Math.max(getSafeInt(item && item.stock, 0), 0)

    return {
      sku_id: getSafeString(item && item.sku_id) || `sku_${index}`,
      sku_name: getSafeString(item && item.sku_name) || `款式${index + 1}`,
      price,
      original_price: originalPrice,
      stock,
      image: getSafeString(item && item.image),
      priceDisplay: formatPrice(price),
      originalPriceDisplay: originalPrice > price ? formatPrice(originalPrice) : ''
    }
  })
}

function buildSkuState(product, selectedSkuId = '') {
  const skus = normalizeSkuList(product)
  const selectedId = getSafeString(selectedSkuId)
  const selectedSku = selectedId
    ? skus.find((item) => item.sku_id === selectedId) || null
    : null
  const defaultSku = skus.find((item) => item.stock > 0) || skus[0] || null
  const minPrice = skus.length
    ? Math.min(...skus.map((item) => item.price))
    : Math.max(getSafeInt(product && product.min_price, 0), 0)
  const minOriginalPrice = skus.length
    ? Math.min(...skus.map((item) => item.original_price || item.price))
    : Math.max(getSafeInt(product && product.min_original_price, minPrice), minPrice)
  const totalStock = skus.length
    ? skus.reduce((sum, item) => sum + Math.max(getSafeInt(item.stock, 0), 0), 0)
    : Math.max(getSafeInt(product && product.total_stock, 0), 0)

  return {
    skus,
    selectedSku,
    defaultSku,
    minPrice,
    minOriginalPrice,
    totalStock,
    skuCount: skus.length,
    hasMultipleSkus: skus.length > 1
  }
}

function buildProductHeroImages(product, skuImage = '') {
  return uniqueList([skuImage, product && product.cover_img, ...((product && product.detail_imgs) || [])])
}

function createProductSummary(product) {
  const state = buildSkuState(product)
  const minPrice = Math.max(getSafeInt(product && product.min_price, state.minPrice), state.minPrice)
  const minOriginalPrice = Math.max(getSafeInt(product && product.min_original_price, state.minOriginalPrice), minPrice)
  const totalStock = Math.max(getSafeInt(product && product.total_stock, state.totalStock), state.totalStock)

  return {
    ...product,
    skus: state.skus,
    skuCount: state.skuCount,
    hasMultipleSkus: state.hasMultipleSkus,
    defaultSku: state.defaultSku,
    min_price: minPrice,
    min_original_price: minOriginalPrice,
    total_stock: totalStock,
    priceDisplay: formatPrice(minPrice),
    originalPriceDisplay: minOriginalPrice > minPrice ? formatPrice(minOriginalPrice) : '',
    priceSuffix: state.hasMultipleSkus ? '起' : ''
  }
}

function createProductSelectionView(product, selectedSkuId = '') {
  const summary = createProductSummary(product)
  const state = buildSkuState(summary, selectedSkuId)
  const hasSelectedSku = Boolean(state.selectedSku)
  const activePrice = hasSelectedSku ? state.selectedSku.price : summary.min_price
  const activeOriginalPrice = hasSelectedSku
    ? Math.max(getSafeInt(state.selectedSku.original_price, state.selectedSku.price), state.selectedSku.price)
    : summary.min_original_price
  const activeStock = hasSelectedSku ? state.selectedSku.stock : summary.total_stock
  const activeImage = getSafeString(hasSelectedSku && state.selectedSku.image) || getSafeString(summary.cover_img)

  return {
    ...summary,
    selectedSku: state.selectedSku,
    defaultSku: state.defaultSku,
    displaySkuName: hasSelectedSku ? state.selectedSku.sku_name : '',
    displayPrice: formatPrice(activePrice),
    displayOriginalPrice: activeOriginalPrice > activePrice ? formatPrice(activeOriginalPrice) : '',
    displayPriceSuffix: hasSelectedSku ? '' : summary.priceSuffix,
    displayStock: activeStock,
    displayImage: activeImage,
    displayHeroImages: buildProductHeroImages(summary, hasSelectedSku ? activeImage : '')
  }
}

function getSelectedOrDefaultSku(product, selectedSkuId = '') {
  const state = buildSkuState(product, selectedSkuId)
  return state.selectedSku || state.defaultSku || null
}

module.exports = {
  formatPrice,
  normalizeSkuList,
  buildSkuState,
  buildProductHeroImages,
  createProductSummary,
  createProductSelectionView,
  getSelectedOrDefaultSku
}
