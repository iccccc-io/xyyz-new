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

function validateProductPayload(payload, { allowZeroTotalStock = false } = {}) {
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
  const logisticsPostage = getSafeString(logisticsInput.postage) || 'free'
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

  const skus = skuInputs.map((item, index) => normalizeSkuInput(item, index))
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
    title,
    intro,
    category,
    cover_img: coverImg,
    detail_imgs: detailImgs,
    related_project_id: relatedProjectId,
    related_project_name: relatedProjectName,
    origin,
    tags,
    ...aggregates,
    skus,
    logistics: {
      method: logisticsMethod,
      postage: logisticsPostage,
      carrier: logisticsCarrier,
      handling_time: handlingTime,
      ship_from: shipFrom
    }
  }
}

async function createProduct(payload) {
  const { openid, user } = await getCurrentUser()

  if (!user.is_certified || !user.workshop_id) {
    throw new Error('仅认证传承人可发布商品')
  }

  const parsed = validateProductPayload(payload)
  await checkTextSecurity(parsed.title, '商品标题包含敏感信息，请修改后重试')
  await checkTextSecurity(parsed.intro, '商品描述包含敏感信息，请修改后重试')
  for (const sku of parsed.skus) {
    await checkTextSecurity(sku.sku_name, '商品款式名称包含敏感信息，请修改后重试')
  }

  const productData = {
    ...parsed,
    author_id: openid,
    workshop_id: user.workshop_id,
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
  const parsed = validateProductPayload(payload, { allowZeroTotalStock: true })

  const existingSkuIds = (Array.isArray(product.skus) ? product.skus : [])
    .map((item) => getSafeString(item && item.sku_id))
    .filter(Boolean)
  const nextSkuIds = new Set(parsed.skus.map((item) => item.sku_id))
  const removedSkuIds = existingSkuIds.filter((item) => !nextSkuIds.has(item))
  if (removedSkuIds.length) {
    throw new Error('已发布商品的已有 SKU 不允许删除，请将库存改为 0 停售')
  }

  await checkTextSecurity(parsed.title, '商品标题包含敏感信息，请修改后重试')
  await checkTextSecurity(parsed.intro, '商品描述包含敏感信息，请修改后重试')
  for (const sku of parsed.skus) {
    await checkTextSecurity(sku.sku_name, '商品款式名称包含敏感信息，请修改后重试')
  }

  const nextIsOnSale = parsed.total_stock > 0
    ? (typeof payload.is_on_sale === 'boolean' ? payload.is_on_sale : product.is_on_sale !== false)
    : false

  await db.collection('shopping_products').doc(productId).update({
    data: {
      ...parsed,
      is_on_sale: nextIsOnSale,
      update_time: db.serverDate()
    }
  })

  return {
    success: true,
    message: '商品更新成功',
    product_id: productId,
    is_on_sale: nextIsOnSale
  }
}

async function updateStock(productId, stock) {
  throw new Error('SKU 商品不支持快捷改库存，请进入编辑页逐个调整款式库存')
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
