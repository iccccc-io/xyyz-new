const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

function getSafeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function getInt(value, fallback = 0) {
  const num = Number(value)
  return Number.isInteger(num) ? num : fallback
}

function getSignedInt(value, fallback = 0) {
  const num = Number(value)
  return Number.isInteger(num) ? num : fallback
}

function uniqueCloudFiles(list) {
  return [...new Set((list || []).filter((item) => typeof item === 'string' && item.startsWith('cloud://')))]
}

function createSkuId() {
  return `sku_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function getNonNegativeInt(value, fallback = 0) {
  const num = Number(value)
  return Number.isInteger(num) && num >= 0 ? num : fallback
}

function normalizeSkuInput(item, index) {
  const skuName = getSafeString(item && item.sku_name) || (index === 0 ? '默认款式' : '')
  const price = getInt(item && item.price, -1)
  const originalPriceRaw = item && item.original_price
  const originalPrice = originalPriceRaw === '' || typeof originalPriceRaw === 'undefined'
    ? price
    : getInt(originalPriceRaw, -1)
  const stock = getNonNegativeInt(item && item.stock, -1)
  const skuId = getSafeString(item && item.sku_id)
  const image = getSafeString(item && item.image)

  if (!skuName) {
    throw new Error(`第 ${index + 1} 个款式名称不能为空`)
  }
  if (price < 1) {
    throw new Error(`第 ${index + 1} 个款式价格不合法`)
  }
  if (originalPrice < price) {
    throw new Error(`第 ${index + 1} 个款式原价不能低于现价`)
  }
  if (stock < 0) {
    throw new Error(`第 ${index + 1} 个款式库存不能小于 0`)
  }

  return {
    sku_id: skuId || createSkuId(),
    sku_name: skuName,
    price,
    original_price: originalPrice,
    stock,
    image
  }
}

function normalizePersistedSku(item, index) {
  const price = getInt(item && item.price, 0)
  const originalPrice = Math.max(getInt(item && (item.original_price || item.price), price), price)
  const stock = getSignedInt(item && item.stock, 0)

  return {
    sku_id: getSafeString(item && item.sku_id) || `sku_${index}`,
    sku_name: getSafeString(item && item.sku_name) || `款式${index + 1}`,
    price,
    original_price: originalPrice,
    stock,
    image: getSafeString(item && item.image)
  }
}

function buildSkuAggregates(skus) {
  const minPrice = Math.min(...skus.map((item) => item.price))
  const minOriginalPrice = Math.min(...skus.map((item) => item.original_price || item.price))
  const totalStock = skus.reduce((sum, item) => sum + item.stock, 0)

  return {
    min_price: minPrice,
    min_original_price: minOriginalPrice,
    total_stock: totalStock
  }
}

function validateBaseProductPayload(payload) {
  const title = getSafeString(payload.title)
  const intro = getSafeString(payload.intro)
  const category = getSafeString(payload.category)
  const coverImg = getSafeString(payload.cover_img)
  const detailImgs = Array.isArray(payload.detail_imgs) ? payload.detail_imgs.filter(Boolean) : []
  const relatedProjectId = getSafeString(payload.related_project_id)
  const relatedProjectName = getSafeString(payload.related_project_name)
  const origin = getSafeString(payload.origin)
  const tags = Array.isArray(payload.tags) ? payload.tags.filter(Boolean) : []
  const skuInputs = Array.isArray(payload.skus) ? payload.skus : []
  const logisticsInput = payload.logistics || {}
  const logisticsMethod = getSafeString(logisticsInput.method) || 'express'
  const logisticsPostage = logisticsMethod === 'pickup'
    ? 'free'
    : (getSafeString(logisticsInput.postage) || 'free')
  const logisticsCarrier = logisticsMethod === 'pickup'
    ? 'pickup'
    : (getSafeString(logisticsInput.carrier) || 'sf_jd')
  const handlingTime = getSafeString(logisticsInput.handling_time) || '48h'
  const shipFrom = getSafeString(logisticsInput.ship_from) || origin || '湖南·长沙'

  if (!title || !intro || !category || !coverImg) {
    throw new Error('标题、描述、分类和封面图不能为空')
  }
  if (title.length < 5 || title.length > 60) {
    throw new Error('商品标题需控制在 5-60 个字之间')
  }
  if (intro.length < 20 || intro.length > 500) {
    throw new Error('商品描述需控制在 20-500 个字之间')
  }
  if (!skuInputs.length) {
    throw new Error('请至少配置一个商品款式')
  }
  if (!detailImgs.length) {
    throw new Error('请至少上传一张详情图')
  }
  if (!relatedProjectId || !relatedProjectName) {
    throw new Error('请先关联非遗项目')
  }

  return {
    title,
    intro,
    category,
    cover_img: coverImg,
    detail_imgs: detailImgs,
    related_project_id: relatedProjectId,
    related_project_name: relatedProjectName,
    origin,
    tags,
    sku_inputs: skuInputs,
    logistics: {
      method: logisticsMethod,
      postage: logisticsPostage,
      carrier: logisticsCarrier,
      handling_time: handlingTime,
      ship_from: shipFrom
    }
  }
}

async function checkTextSecurity(text, message) {
  try {
    const res = await cloud.openapi.security.msgSecCheck({ content: text })
    if (res && res.errCode !== 0) {
      throw new Error(message)
    }
  } catch (err) {
    if (err.errCode === 87014) {
      throw new Error(message)
    }
    console.warn('[manage_shopping_product] 文本安全校验异常:', err.message || err)
  }
}

async function getCurrentUser() {
  const { OPENID } = cloud.getWXContext()
  const userRes = await db.collection('users')
    .where({ _openid: OPENID })
    .limit(1)
    .get()

  if (!userRes.data || !userRes.data.length) {
    throw new Error('用户信息不存在')
  }

  return {
    openid: OPENID,
    user: userRes.data[0]
  }
}

async function ensureProductOwner(productId, openid) {
  const productRes = await db.collection('shopping_products').doc(productId).get()
  const product = productRes.data

  if (!product) {
    throw new Error('商品不存在')
  }

  if (product.author_id !== openid) {
    throw new Error('无权操作该商品')
  }

  return product
}

function validateCreateProductPayload(payload, { allowZeroTotalStock = false } = {}) {
  const base = validateBaseProductPayload(payload)
  const skus = base.sku_inputs.map((item, index) => normalizeSkuInput(item, index))
  const skuIdSet = new Set()
  skus.forEach((sku) => {
    if (skuIdSet.has(sku.sku_id)) {
      throw new Error('SKU 标识重复，请重新保存商品')
    }
    skuIdSet.add(sku.sku_id)
  })

  const aggregates = buildSkuAggregates(skus)
  if (!allowZeroTotalStock && aggregates.total_stock < 1) {
    throw new Error('至少需要一个可售库存大于 0 的款式')
  }

  return {
    ...base,
    ...aggregates,
    skus
  }
}

function validateUpdateProductPayload(payload, product) {
  const base = validateBaseProductPayload(payload)
  const existingSkus = Array.isArray(product && product.skus) ? product.skus : []
  const existingSkuIdSet = new Set(existingSkus.map((item) => getSafeString(item && item.sku_id)).filter(Boolean))
  const normalizedSkuChanges = []
  const submittedExistingIds = new Set()
  const seenSkuIds = new Set()

  base.sku_inputs.forEach((item, index) => {
    const skuName = getSafeString(item && item.sku_name) || (index === 0 ? '默认款式' : '')
    const price = getInt(item && item.price, -1)
    const originalPriceRaw = item && item.original_price
    const originalPrice = originalPriceRaw === '' || typeof originalPriceRaw === 'undefined'
      ? price
      : getInt(originalPriceRaw, -1)
    const skuId = getSafeString(item && item.sku_id)
    const image = getSafeString(item && item.image)

    if (!skuName) {
      throw new Error(`第 ${index + 1} 个款式名称不能为空`)
    }
    if (price < 1) {
      throw new Error(`第 ${index + 1} 个款式价格不合法`)
    }
    if (originalPrice < price) {
      throw new Error(`第 ${index + 1} 个款式原价不能低于现价`)
    }

    if (skuId && existingSkuIdSet.has(skuId)) {
      const stockChangeRaw = item && item.stock_change
      const stockChange = stockChangeRaw === '' || stockChangeRaw === null || typeof stockChangeRaw === 'undefined'
        ? 0
        : getSignedInt(stockChangeRaw, NaN)

      if (!Number.isInteger(stockChange)) {
        throw new Error(`第 ${index + 1} 个款式库存调整值不合法`)
      }
      if (seenSkuIds.has(skuId)) {
        throw new Error('SKU 标识重复，请重新保存商品')
      }
      seenSkuIds.add(skuId)
      submittedExistingIds.add(skuId)

      normalizedSkuChanges.push({
        type: 'existing',
        sku_id: skuId,
        sku_name: skuName,
        price,
        original_price: originalPrice,
        stock_change: stockChange,
        image
      })
      return
    }

    if (skuId && !existingSkuIdSet.has(skuId)) {
      throw new Error('SKU 数据已变化，请重新进入编辑页后再保存')
    }

    const stock = getNonNegativeInt(item && item.stock, -1)
    if (stock < 0) {
      throw new Error(`第 ${index + 1} 个新增款式库存不能小于 0`)
    }

    const nextSkuId = createSkuId()
    if (seenSkuIds.has(nextSkuId)) {
      throw new Error('SKU 标识生成失败，请重试')
    }
    seenSkuIds.add(nextSkuId)

    normalizedSkuChanges.push({
      type: 'new',
      sku_id: nextSkuId,
      sku_name: skuName,
      price,
      original_price: originalPrice,
      stock,
      image
    })
  })

  const removedSkuIds = Array.from(existingSkuIdSet).filter((item) => !submittedExistingIds.has(item))
  if (removedSkuIds.length) {
    throw new Error('已发布商品的已有 SKU 不允许删除，请将库存改为 0 停售')
  }

  return {
    ...base,
    sku_changes: normalizedSkuChanges
  }
}

async function applySkuChangesInTransaction(productId, {
  skuChanges = [],
  baseUpdates = {},
  desiredIsOnSale,
  allowNewSkus = false
} = {}) {
  const transaction = await db.startTransaction()

  try {
    const currentRes = await transaction.collection('shopping_products').doc(productId).get()
    const currentProduct = currentRes.data

    if (!currentProduct) {
      throw new Error('商品不存在')
    }

    const currentSkus = Array.isArray(currentProduct.skus) ? currentProduct.skus : []
    if (!currentSkus.length && !skuChanges.some((item) => item.type === 'new')) {
      throw new Error('当前商品不存在可编辑的 SKU')
    }

    const currentSkuMap = new Map()
    currentSkus.forEach((item, index) => {
      const skuId = getSafeString(item && item.sku_id)
      if (!skuId) return
      currentSkuMap.set(skuId, { index, sku: item })
    })

    const updateExistingData = {}
    const newSkuDocs = []
    let existingStockChange = 0
    let newSkuStockTotal = 0

    skuChanges.forEach((item) => {
      if (item.type === 'existing') {
        const currentEntry = currentSkuMap.get(item.sku_id)
        if (!currentEntry) {
          throw new Error('SKU 数据已变化，请重新进入页面后再保存')
        }

        const basePath = `skus.${currentEntry.index}`
        updateExistingData[`${basePath}.sku_name`] = item.sku_name
        updateExistingData[`${basePath}.price`] = item.price
        updateExistingData[`${basePath}.original_price`] = item.original_price
        updateExistingData[`${basePath}.image`] = item.image

        if (item.stock_change) {
          updateExistingData[`${basePath}.stock`] = _.inc(item.stock_change)
          existingStockChange += item.stock_change
        }
        return
      }

      if (!allowNewSkus) {
        throw new Error('当前入口不支持新增 SKU，请进入编辑页操作')
      }

      newSkuDocs.push({
        sku_id: item.sku_id,
        sku_name: item.sku_name,
        price: item.price,
        original_price: item.original_price,
        stock: item.stock,
        image: item.image
      })
      newSkuStockTotal += item.stock
    })

    if (Object.keys(updateExistingData).length || existingStockChange !== 0) {
      const firstUpdateData = { ...updateExistingData }
      if (existingStockChange !== 0) {
        firstUpdateData.total_stock = _.inc(existingStockChange)
      }

      await transaction.collection('shopping_products').doc(productId).update({
        data: firstUpdateData
      })
    }

    if (newSkuDocs.length) {
      await transaction.collection('shopping_products').doc(productId).update({
        data: {
          skus: _.push(newSkuDocs),
          total_stock: _.inc(newSkuStockTotal)
        }
      })
    }

    const checkedRes = await transaction.collection('shopping_products').doc(productId).get()
    const checkedProduct = checkedRes.data || {}
    const checkedSkus = (Array.isArray(checkedProduct.skus) ? checkedProduct.skus : []).map(normalizePersistedSku)

    if (!checkedSkus.length) {
      throw new Error('商品至少需要保留一个 SKU')
    }

    checkedSkus.forEach((sku) => {
      if (sku.stock < 0) {
        throw new Error(`款式 [${sku.sku_name}] 库存不足，修改失败`)
      }
    })

    const aggregates = buildSkuAggregates(checkedSkus)
    const nextIsOnSale = aggregates.total_stock > 0
      ? (typeof desiredIsOnSale === 'boolean' ? desiredIsOnSale : checkedProduct.is_on_sale !== false)
      : false

    await transaction.collection('shopping_products').doc(productId).update({
      data: {
        ...baseUpdates,
        min_price: aggregates.min_price,
        min_original_price: aggregates.min_original_price,
        total_stock: aggregates.total_stock,
        is_on_sale: nextIsOnSale,
        update_time: db.serverDate()
      }
    })

    await transaction.commit()

    return {
      success: true,
      message: 'SKU 信息已更新',
      product_id: productId,
      total_stock: aggregates.total_stock,
      is_on_sale: nextIsOnSale
    }
  } catch (err) {
    await transaction.rollback()
    throw err
  }
}

async function createProduct(payload) {
  const { openid, user } = await getCurrentUser()

  if (!user.is_certified || !user.workshop_id) {
    throw new Error('仅认证传承人可发布商品')
  }

  const parsed = validateCreateProductPayload(payload)
  await checkTextSecurity(parsed.title, '商品标题包含敏感信息，请修改后重试')
  await checkTextSecurity(parsed.intro, '商品描述包含敏感信息，请修改后重试')
  for (const sku of parsed.skus) {
    await checkTextSecurity(sku.sku_name, '商品款式名称包含敏感信息，请修改后重试')
  }

  const workshopRes = await db.collection('shopping_workshops')
    .doc(user.workshop_id)
    .get()
    .catch(() => ({ data: null }))
  const workshopName = getSafeString(workshopRes.data && workshopRes.data.name) || '非遗工坊'

  const productData = {
    ...parsed,
    author_id: openid,
    workshop_id: user.workshop_id,
    workshop_name: workshopName,
    sales: 0,
    view_count: 0,
    rating_avg: 0,
    review_count: 0,
    status: 1,
    is_on_sale: parsed.total_stock > 0,
    create_time: db.serverDate(),
    update_time: db.serverDate()
  }

  const addRes = await db.collection('shopping_products').add({
    data: productData
  })

  await db.collection('shopping_workshops').doc(user.workshop_id).update({
    data: {
      product_count: _.inc(1),
      update_time: db.serverDate()
    }
  }).catch(() => {})

  return {
    success: true,
    message: '商品发布成功',
    product_id: addRes._id
  }
}

async function updateProduct(productId, payload) {
  const { openid } = await getCurrentUser()
  const product = await ensureProductOwner(productId, openid)
  const parsed = validateUpdateProductPayload(payload, product)

  await checkTextSecurity(parsed.title, '商品标题包含敏感信息，请修改后重试')
  await checkTextSecurity(parsed.intro, '商品描述包含敏感信息，请修改后重试')
  for (const sku of parsed.sku_changes) {
    await checkTextSecurity(sku.sku_name, '商品款式名称包含敏感信息，请修改后重试')
  }

  const workshopRes = product.workshop_id
    ? await db.collection('shopping_workshops')
      .doc(product.workshop_id)
      .get()
      .catch(() => ({ data: null }))
    : { data: null }
  const workshopName = getSafeString(workshopRes.data && workshopRes.data.name) || getSafeString(product.workshop_name) || '非遗工坊'

  const result = await applySkuChangesInTransaction(productId, {
    skuChanges: parsed.sku_changes,
    desiredIsOnSale: typeof payload.is_on_sale === 'boolean' ? payload.is_on_sale : product.is_on_sale !== false,
    allowNewSkus: true,
    baseUpdates: {
      title: parsed.title,
      intro: parsed.intro,
      category: parsed.category,
      cover_img: parsed.cover_img,
      detail_imgs: parsed.detail_imgs,
      related_project_id: parsed.related_project_id,
      related_project_name: parsed.related_project_name,
      origin: parsed.origin,
      tags: parsed.tags,
      logistics: parsed.logistics,
      workshop_name: workshopName
    }
  })

  return {
    ...result,
    message: '商品更新成功'
  }
}

async function updateStock(productId, stock) {
  throw new Error('SKU 商品不支持快捷改库存，请进入编辑页逐个调整款式库存')
}

async function quickUpdateSkus(productId, skuUpdates = []) {
  const { openid } = await getCurrentUser()
  const product = await ensureProductOwner(productId, openid)

  const existingSkus = Array.isArray(product.skus) ? product.skus : []
  if (!existingSkus.length) {
    throw new Error('当前商品不存在可编辑的 SKU')
  }

  if (!Array.isArray(skuUpdates) || !skuUpdates.length) {
    throw new Error('请至少提交一个 SKU 修改项')
  }

  const updateMap = new Map()
  skuUpdates.forEach((item) => {
    const skuId = getSafeString(item && item.sku_id)
    if (!skuId) return

    const price = getInt(item && item.price, -1)
    const originalPriceRaw = item && item.original_price
    const originalPrice = originalPriceRaw === '' || typeof originalPriceRaw === 'undefined'
      ? price
      : getInt(originalPriceRaw, -1)
    const stockChangeRaw = item && item.stock_change
    const stockChange = stockChangeRaw === '' || stockChangeRaw === null || typeof stockChangeRaw === 'undefined'
      ? 0
      : getSignedInt(stockChangeRaw, NaN)

    if (price < 1) {
      throw new Error('SKU 现价必须大于 0')
    }
    if (originalPrice < price) {
      throw new Error('SKU 原价不能低于现价')
    }
    if (!Number.isInteger(stockChange)) {
      throw new Error('SKU 库存调整值不合法')
    }

    updateMap.set(skuId, {
      sku_id: skuId,
      sku_name: getSafeString(item && item.sku_name) || getSafeString((existingSkus.find((sku) => getSafeString(sku && sku.sku_id) === skuId) || {}).sku_name),
      price,
      original_price: originalPrice,
      stock_change: stockChange,
      image: getSafeString(item && item.image) || getSafeString((existingSkus.find((sku) => getSafeString(sku && sku.sku_id) === skuId) || {}).image),
      type: 'existing'
    })
  })

  if (!updateMap.size) {
    throw new Error('缺少有效的 SKU 修改项')
  }

  return applySkuChangesInTransaction(productId, {
    skuChanges: Array.from(updateMap.values()),
    desiredIsOnSale: product.is_on_sale !== false
  })
}

async function toggleSale(productId, isOnSale) {
  const { openid } = await getCurrentUser()
  const product = await ensureProductOwner(productId, openid)

  if (typeof isOnSale !== 'boolean') {
    throw new Error('上下架参数不合法')
  }

  if (isOnSale && (!product.total_stock || product.total_stock <= 0)) {
    throw new Error('库存为 0 的商品无法上架，请先补充库存')
  }

  await db.collection('shopping_products').doc(productId).update({
    data: {
      is_on_sale: isOnSale,
      update_time: db.serverDate()
    }
  })

  return {
    success: true,
    message: isOnSale ? '商品已上架' : '商品已下架',
    is_on_sale: isOnSale
  }
}

async function deleteProduct(productId) {
  const { openid, user } = await getCurrentUser()
  const product = await ensureProductOwner(productId, openid)

  if (product.is_on_sale !== false) {
    throw new Error('请先下架商品后再删除')
  }

  const orderCountRes = await db.collection('shopping_orders')
    .where({
      'product_snapshot.product_id': productId
    })
    .count()

  if ((orderCountRes.total || 0) > 0) {
    throw new Error('该商品已有交易记录，为保障财务对账，仅支持下架处理。')
  }

  const skuImages = (Array.isArray(product.skus) ? product.skus : []).map((item) => item.image)
  const fileList = uniqueCloudFiles([product.cover_img, ...(product.detail_imgs || []), ...skuImages])
  if (fileList.length) {
    await cloud.deleteFile({ fileList }).catch(() => {})
  }

  await db.collection('shopping_products').doc(productId).remove()

  if (user.workshop_id) {
    await db.collection('shopping_workshops').doc(user.workshop_id).update({
      data: {
        product_count: _.inc(-1),
        update_time: db.serverDate()
      }
    }).catch(() => {})
  }

  return {
    success: true,
    message: '商品已删除'
  }
}

exports.main = async (event) => {
  const { action, product_id, payload = {}, stock, is_on_sale } = event

  try {
    switch (action) {
      case 'create':
        return await createProduct(payload)
      case 'update':
        if (!product_id) throw new Error('缺少 product_id')
        return await updateProduct(product_id, payload)
      case 'update_stock':
        if (!product_id) throw new Error('缺少 product_id')
        return await updateStock(product_id, Number(stock))
      case 'quick_update_skus':
        if (!product_id) throw new Error('缺少 product_id')
        return await quickUpdateSkus(product_id, payload.skus || [])
      case 'toggle_sale':
        if (!product_id) throw new Error('缺少 product_id')
        return await toggleSale(product_id, Boolean(is_on_sale))
      case 'delete':
        if (!product_id) throw new Error('缺少 product_id')
        return await deleteProduct(product_id)
      default:
        return {
          success: false,
          message: '不支持的操作类型'
        }
    }
  } catch (err) {
    console.error('[manage_shopping_product]', err)
    return {
      success: false,
      message: err.message || '商品操作失败'
    }
  }
}
