const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const DEFAULT_ANONYMOUS_AVATAR = '/images/review-anonymous-avatar.svg'
const INTERNAL_AUTO_REVIEW_TOKEN = 'xyyz_review_auto_v1'
const MAX_REVIEW_IMAGES = 9
const MAX_REVIEW_CONTENT_LENGTH = 500
const MAX_REPLY_CONTENT_LENGTH = 200
const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 20
const SKU_FETCH_BATCH_SIZE = 100

function getSafeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function getSafeNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function normalizePage(value) {
  const page = Math.floor(Number(value) || 1)
  return page > 0 ? page : 1
}

function normalizePageSize(value) {
  const size = Math.floor(Number(value) || DEFAULT_PAGE_SIZE)
  if (size < 1) return DEFAULT_PAGE_SIZE
  return Math.min(size, MAX_PAGE_SIZE)
}

function normalizeRatingValue(value) {
  const rating = Math.round(Number(value) || 0)
  if (rating < 1 || rating > 5) {
    throw new Error('评分需在 1-5 分之间')
  }
  return rating
}

function normalizeReviewContent(value) {
  const content = getSafeString(value)
  if (content.length > MAX_REVIEW_CONTENT_LENGTH) {
    throw new Error(`评价内容不能超过 ${MAX_REVIEW_CONTENT_LENGTH} 字`)
  }
  return content
}

function normalizeReplyContent(value) {
  const content = getSafeString(value)
  if (!content) {
    throw new Error('请输入回复内容')
  }
  if (content.length > MAX_REPLY_CONTENT_LENGTH) {
    throw new Error(`回复内容不能超过 ${MAX_REPLY_CONTENT_LENGTH} 字`)
  }
  return content
}

function normalizeImageList(images) {
  const list = Array.isArray(images)
    ? images
        .map((item) => getSafeString(item))
        .filter((item) => item && item.startsWith('cloud://'))
    : []
  return [...new Set(list)].slice(0, MAX_REVIEW_IMAGES)
}

function escapeRegExpKeyword(keyword) {
  return String(keyword || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildAndCondition(conditions) {
  const list = (conditions || []).filter(Boolean)
  if (!list.length) return {}
  if (list.length === 1) return list[0]
  return _.and(list)
}

function getOrderReviewState(order) {
  const reviewStatus = Number(order && order.review_status) === 1 ? 1 : 0
  const reviewId = getSafeString(order && order.review_id)
  return {
    reviewStatus,
    reviewId
  }
}

function getWorkshopOwnerOpenid(workshop) {
  return getSafeString(workshop && (workshop.owner_openid || workshop.owner_id))
}

function calcSlidingAverage(currentAvg, currentCount, nextScore) {
  const count = Math.max(0, Math.floor(getSafeNumber(currentCount, 0)))
  if (count <= 0) {
    return Number(getSafeNumber(nextScore, 0).toFixed(1))
  }
  return Number((((getSafeNumber(currentAvg, 0) * count) + getSafeNumber(nextScore, 0)) / (count + 1)).toFixed(1))
}

function normalizeWorkshopRatingDetails(details, reviewCount = 0) {
  const count = Math.max(0, Math.floor(getSafeNumber(reviewCount, 0)))
  const normalized = {
    service: getSafeNumber(details && details.service, 0),
    logistics: getSafeNumber(details && details.logistics, 0),
    quality: getSafeNumber(details && details.quality, 0)
  }

  if (count <= 0) {
    return {
      service: 0,
      logistics: 0,
      quality: 0
    }
  }

  return {
    service: Number(normalized.service.toFixed(1)),
    logistics: Number(normalized.logistics.toFixed(1)),
    quality: Number(normalized.quality.toFixed(1))
  }
}

function maskUserInfo(userInfo, isAnonymous) {
  if (isAnonymous) {
    return {
      nickname: '非***友',
      avatar: DEFAULT_ANONYMOUS_AVATAR
    }
  }

  return {
    nickname: getSafeString(userInfo && userInfo.nickname) || '用户',
    avatar: getSafeString(userInfo && userInfo.avatar) || DEFAULT_ANONYMOUS_AVATAR
  }
}

function sanitizeSellerReply(reply) {
  if (!reply || !getSafeString(reply.content)) {
    return null
  }

  return {
    content: getSafeString(reply.content),
    reply_time: reply.reply_time || null,
    seller_name: getSafeString(reply.seller_name) || '工坊回复'
  }
}

function sanitizeReviewDoc(review, options = {}) {
  const isAnonymous = review.is_anonymous === true
  const sanitized = {
    ...review,
    is_anonymous: isAnonymous,
    user_info: maskUserInfo(review.user_info, isAnonymous),
    seller_reply: sanitizeSellerReply(review.seller_reply),
    can_reply: Boolean(options.isWorkshopOwner && !sanitizeSellerReply(review.seller_reply))
  }

  if (!options.showSku) {
    delete sanitized.sku_info
  }

  return sanitized
}

async function getCurrentUser(openid) {
  if (!openid) return null

  const res = await db.collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get()

  return res.data && res.data.length ? res.data[0] : null
}

async function fetchSkuOptions(productId) {
  const optionsMap = new Map()
  let skip = 0

  while (true) {
    const res = await db.collection('shopping_reviews')
      .where({ product_id: productId })
      .field({
        sku_info: true
      })
      .skip(skip)
      .limit(SKU_FETCH_BATCH_SIZE)
      .get()

    const list = res.data || []
    list.forEach((item) => {
      const skuId = getSafeString(item && item.sku_info && item.sku_info.sku_id)
      const skuName = getSafeString(item && item.sku_info && item.sku_info.sku_name)
      if (!skuId || !skuName) return

      if (optionsMap.has(skuId)) {
        optionsMap.get(skuId).count += 1
      } else {
        optionsMap.set(skuId, {
          sku_id: skuId,
          sku_name: skuName,
          count: 1
        })
      }
    })

    if (list.length < SKU_FETCH_BATCH_SIZE) {
      break
    }

    skip += list.length
  }

  return Array.from(optionsMap.values()).sort((a, b) => a.sku_name.localeCompare(b.sku_name, 'zh-Hans-CN'))
}

async function computeReviewStats(whereCondition) {
  let skip = 0
  let count = 0
  let scoreSum = 0

  while (true) {
    const res = await db.collection('shopping_reviews')
      .where(whereCondition)
      .field({ avg_score: true })
      .skip(skip)
      .limit(SKU_FETCH_BATCH_SIZE)
      .get()

    const list = res.data || []
    list.forEach((item) => {
      count += 1
      scoreSum += getSafeNumber(item.avg_score, 0)
    })

    if (list.length < SKU_FETCH_BATCH_SIZE) {
      break
    }

    skip += list.length
  }

  return {
    review_count: count,
    rating_avg: count > 0 ? Number((scoreSum / count).toFixed(1)) : 0
  }
}

async function computeWorkshopRatingSummary(workshopId) {
  let skip = 0
  let reviewCount = 0
  let scoreSum = 0
  let serviceSum = 0
  let logisticsSum = 0
  let qualitySum = 0

  while (true) {
    const res = await db.collection('shopping_reviews')
      .where({ workshop_id: workshopId })
      .field({
        avg_score: true,
        rating: true
      })
      .skip(skip)
      .limit(SKU_FETCH_BATCH_SIZE)
      .get()

    const list = res.data || []
    list.forEach((item) => {
      const rating = item && item.rating ? item.rating : {}
      reviewCount += 1
      scoreSum += getSafeNumber(item.avg_score, 0)
      serviceSum += getSafeNumber(rating.service, 0)
      logisticsSum += getSafeNumber(rating.logis, 0)
      qualitySum += getSafeNumber(rating.product, 0)
    })

    if (list.length < SKU_FETCH_BATCH_SIZE) {
      break
    }

    skip += list.length
  }

  if (reviewCount <= 0) {
    return {
      review_count: 0,
      shop_rating: 0,
      rating_details: {
        service: 0,
        logistics: 0,
        quality: 0
      }
    }
  }

  return {
    review_count: reviewCount,
    shop_rating: Number((scoreSum / reviewCount).toFixed(1)),
    rating_details: {
      service: Number((serviceSum / reviewCount).toFixed(1)),
      logistics: Number((logisticsSum / reviewCount).toFixed(1)),
      quality: Number((qualitySum / reviewCount).toFixed(1))
    }
  }
}

async function createReviewByOrder(params) {
  const {
    orderId,
    operatorOpenid,
    userRecord,
    isAnonymous,
    content,
    images,
    rating,
    isAuto,
    skipOwnerCheck
  } = params

  const reviewContent = normalizeReviewContent(content)
  const reviewImages = normalizeImageList(images)
  if (!isAuto && !reviewContent && !reviewImages.length) {
    throw new Error('请填写评价内容或上传晒图')
  }

  const normalizedRating = {
    product: normalizeRatingValue(rating.product),
    logis: normalizeRatingValue(rating.logis),
    service: normalizeRatingValue(rating.service)
  }

  const avgScore = Number(((normalizedRating.product + normalizedRating.logis + normalizedRating.service) / 3).toFixed(1))
  const transaction = await db.startTransaction()

  try {
    const orderRes = await transaction.collection('shopping_orders').doc(orderId).get()
    const order = orderRes.data
    if (!order) {
      throw new Error('订单不存在')
    }

    if (!skipOwnerCheck && order._openid !== operatorOpenid) {
      throw new Error('无权评价该订单')
    }

    if (order.status !== 40) {
      throw new Error('仅已完成订单可评价')
    }

    if (order.status === 60 || order.has_aftersale === true) {
      throw new Error('售后订单不可评价')
    }

    const reviewState = getOrderReviewState(order)
    if (reviewState.reviewStatus === 1 || reviewState.reviewId) {
      throw new Error('该订单已评价')
    }

    const existingReviewRes = await transaction.collection('shopping_reviews')
      .where({ order_id: order._id })
      .limit(1)
      .get()

    if (existingReviewRes.data && existingReviewRes.data.length) {
      throw new Error('该订单已评价')
    }

    const snapshot = order.product_snapshot || {}
    const productId = getSafeString(snapshot.product_id)
    const workshopId = getSafeString(order.workshop_id || snapshot.workshop_id)
    if (!productId || !workshopId) {
      throw new Error('订单商品信息异常，暂无法评价')
    }

    const [productRes, workshopRes] = await Promise.all([
      transaction.collection('shopping_products').doc(productId).get(),
      transaction.collection('shopping_workshops').doc(workshopId).get()
    ])

    const product = productRes.data
    const workshop = workshopRes.data
    if (!product) {
      throw new Error('商品不存在')
    }
    if (!workshop) {
      throw new Error('工坊不存在')
    }

    const buyerRecord = userRecord || await getCurrentUser(order._openid)
    const buyerNickname = getSafeString(buyerRecord && buyerRecord.nickname) || '用户'
    const buyerAvatar = getSafeString(
      buyerRecord && (buyerRecord.avatar_url || buyerRecord.avatar_file_id || buyerRecord.avatar)
    )

    const reviewDoc = {
      order_id: order._id,
      product_id: productId,
      workshop_id: workshopId,
      user_info: {
        nickname: buyerNickname,
        avatar: buyerAvatar,
        openid: order._openid || operatorOpenid || ''
      },
      is_anonymous: Boolean(isAnonymous),
      sku_info: {
        sku_id: getSafeString(snapshot.sku_id),
        sku_name: getSafeString(snapshot.sku_name) || '默认款式'
      },
      product_snapshot: {
        title: getSafeString(snapshot.title) || getSafeString(product.title) || '非遗文创',
        cover_img: getSafeString(snapshot.cover_img) || getSafeString(snapshot.sku_image) || getSafeString(product.cover_img)
      },
      rating: normalizedRating,
      avg_score: avgScore,
      content: reviewContent,
      images: reviewImages,
      has_images: reviewImages.length > 0,
      buy_time: order.create_time || null,
      create_time: db.serverDate(),
      is_auto: Boolean(isAuto),
      seller_reply: null
    }

    const addRes = await transaction.collection('shopping_reviews').add({
      data: reviewDoc
    })

    const productReviewCount = Math.max(0, Math.floor(getSafeNumber(product.review_count, 0)))
    const productRatingAvg = getSafeNumber(product.rating_avg, 0)
    const nextProductRating = calcSlidingAverage(productRatingAvg, productReviewCount, avgScore)

    const workshopReviewCount = Math.max(0, Math.floor(getSafeNumber(workshop.shop_review_count, 0)))
    const workshopRatingAvg = getSafeNumber(workshop.shop_rating, getSafeNumber(workshop.rating, 0))
    const nextWorkshopRating = calcSlidingAverage(workshopRatingAvg, workshopReviewCount, avgScore)
    const workshopRatingDetails = normalizeWorkshopRatingDetails(workshop.rating_details, workshopReviewCount)
    const nextWorkshopRatingDetails = {
      service: calcSlidingAverage(workshopRatingDetails.service, workshopReviewCount, normalizedRating.service),
      logistics: calcSlidingAverage(workshopRatingDetails.logistics, workshopReviewCount, normalizedRating.logis),
      quality: calcSlidingAverage(workshopRatingDetails.quality, workshopReviewCount, normalizedRating.product)
    }

    await Promise.all([
      transaction.collection('shopping_orders').doc(order._id).update({
        data: {
          review_status: 1,
          review_id: addRes._id,
          update_time: db.serverDate()
        }
      }),
      transaction.collection('shopping_products').doc(productId).update({
        data: {
          rating_avg: nextProductRating,
          review_count: _.inc(1),
          update_time: db.serverDate()
        }
      }),
      transaction.collection('shopping_workshops').doc(workshopId).update({
        data: {
          shop_rating: nextWorkshopRating,
          shop_review_count: _.inc(1),
          rating: nextWorkshopRating,
          rating_details: nextWorkshopRatingDetails,
          update_time: db.serverDate()
        }
      })
    ])

    await transaction.commit()

    return {
      review_id: addRes._id,
      avg_score: avgScore
    }
  } catch (err) {
    await transaction.rollback().catch(() => {})
    throw err
  }
}

async function submit(event, openid) {
  if (!openid) {
    throw new Error('请先登录后再评价')
  }

  const orderId = getSafeString(event.order_id)
  if (!orderId) {
    throw new Error('缺少订单信息')
  }

  const userRecord = await getCurrentUser(openid)
  if (!userRecord) {
    throw new Error('用户信息不存在')
  }

  const result = await createReviewByOrder({
    orderId,
    operatorOpenid: openid,
    userRecord,
    isAnonymous: event.is_anonymous === true,
    content: event.content,
    images: event.images,
    rating: event.rating || {},
    isAuto: false,
    skipOwnerCheck: false
  })

  return {
    success: true,
    message: '评价提交成功',
    review_id: result.review_id
  }
}

async function submitAuto(event) {
  const token = getSafeString(event._internal_token)
  if (token !== INTERNAL_AUTO_REVIEW_TOKEN) {
    throw new Error('非法调用')
  }

  const orderId = getSafeString(event.order_id)
  if (!orderId) {
    throw new Error('缺少订单信息')
  }

  const result = await createReviewByOrder({
    orderId,
    operatorOpenid: '',
    userRecord: null,
    isAnonymous: true,
    content: '系统默认好评',
    images: [],
    rating: {
      product: 5,
      logis: 5,
      service: 5
    },
    isAuto: true,
    skipOwnerCheck: true
  })

  return {
    success: true,
    review_id: result.review_id
  }
}

async function getDetail(event, openid) {
  const reviewId = getSafeString(event.review_id)
  if (!reviewId) {
    throw new Error('缺少评价信息')
  }

  const reviewRes = await db.collection('shopping_reviews').doc(reviewId).get()
  const review = reviewRes.data
  if (!review) {
    throw new Error('评价不存在')
  }

  let isWorkshopOwner = false
  if (openid && getSafeString(review.workshop_id)) {
    try {
      const workshopRes = await db.collection('shopping_workshops').doc(review.workshop_id).get()
      isWorkshopOwner = Boolean(workshopRes.data && getWorkshopOwnerOpenid(workshopRes.data) === openid)
    } catch (err) {}
  }

  return {
    success: true,
    review: sanitizeReviewDoc(review, {
      showSku: true,
      isWorkshopOwner
    })
  }
}

function buildProductConditions(productId, skuId) {
  const conditions = [{ product_id: productId }]
  if (skuId) {
    conditions.push({ 'sku_info.sku_id': skuId })
  }
  return conditions
}

function applyProductFilter(conditions, filterType, keyword) {
  const next = [...conditions]
  if (filterType === 'positive') {
    next.push({ avg_score: _.gte(4) })
  } else if (filterType === 'negative') {
    next.push({ avg_score: _.lte(2) })
  } else if (filterType === 'with_images') {
    next.push({ has_images: true })
  }

  const trimmedKeyword = getSafeString(keyword)
  if (trimmedKeyword) {
    next.push({
      content: db.RegExp({
        regexp: escapeRegExpKeyword(trimmedKeyword),
        options: 'i'
      })
    })
  }
  return next
}

async function listProduct(event) {
  const productId = getSafeString(event.product_id)
  if (!productId) {
    throw new Error('缺少商品信息')
  }

  const page = normalizePage(event.page)
  const pageSize = normalizePageSize(event.page_size)
  const skuId = getSafeString(event.sku_id)
  const filterType = getSafeString(event.filter_type) || 'all'
  const keyword = getSafeString(event.keyword)
  const skip = (page - 1) * pageSize

  const baseConditions = buildProductConditions(productId, skuId)
  const listConditions = applyProductFilter(baseConditions, filterType, keyword)
  const baseWhere = buildAndCondition(baseConditions)
  const listWhere = buildAndCondition(listConditions)

  const [
    productRes,
    listCountRes,
    listRes,
    positiveCountRes,
    negativeCountRes,
    withImagesCountRes,
    skuOptions
  ] = await Promise.all([
    db.collection('shopping_products').doc(productId).get().catch(() => ({ data: null })),
    db.collection('shopping_reviews').where(listWhere).count(),
    db.collection('shopping_reviews')
      .where(listWhere)
      .orderBy('create_time', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get(),
    db.collection('shopping_reviews').where(buildAndCondition([...baseConditions, { avg_score: _.gte(4) }])).count(),
    db.collection('shopping_reviews').where(buildAndCondition([...baseConditions, { avg_score: _.lte(2) }])).count(),
    db.collection('shopping_reviews').where(buildAndCondition([...baseConditions, { has_images: true }])).count(),
    fetchSkuOptions(productId)
  ])

  const product = productRes.data || {}
  const aggregateStats = skuId
    ? await computeReviewStats(baseWhere)
    : {
        review_count: Math.max(0, Math.floor(getSafeNumber(product.review_count, 0))),
        rating_avg: Math.max(0, getSafeNumber(product.rating_avg, 0))
      }
  const reviewCount = aggregateStats.review_count
  const ratingAvg = reviewCount > 0 ? Number(getSafeNumber(aggregateStats.rating_avg, 0).toFixed(1)) : 0

  return {
    success: true,
    list: (listRes.data || []).map((item) => sanitizeReviewDoc(item, { showSku: true })),
    page,
    page_size: pageSize,
    has_more: skip + (listRes.data || []).length < (listCountRes.total || 0),
    summary: {
      rating_avg: ratingAvg,
      review_count: reviewCount,
      positive_count: positiveCountRes.total || 0,
      negative_count: negativeCountRes.total || 0,
      with_image_count: withImagesCountRes.total || 0
    },
    sku_options: skuOptions
  }
}

async function listWorkshop(event, openid) {
  const workshopId = getSafeString(event.workshop_id)
  if (!workshopId) {
    throw new Error('缺少工坊信息')
  }

  const page = normalizePage(event.page)
  const pageSize = normalizePageSize(event.page_size)
  const skip = (page - 1) * pageSize

  const workshopRes = await db.collection('shopping_workshops').doc(workshopId).get()
  const workshop = workshopRes.data
  if (!workshop) {
    throw new Error('工坊不存在')
  }

  const isWorkshopOwner = Boolean(openid && getWorkshopOwnerOpenid(workshop) === openid)
  const [countRes, listRes] = await Promise.all([
    db.collection('shopping_reviews').where({ workshop_id: workshopId }).count(),
    db.collection('shopping_reviews')
      .where({ workshop_id: workshopId })
      .orderBy('create_time', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get()
  ])

  let reviewCount = Math.max(0, Math.floor(getSafeNumber(workshop.shop_review_count, countRes.total || 0)))
  let shopRating = getSafeNumber(workshop.shop_rating, getSafeNumber(workshop.rating, 0))
  let ratingDetails = normalizeWorkshopRatingDetails(workshop.rating_details, reviewCount)
  const needsAggregateFallback = reviewCount > 0 && (
    shopRating <= 0 ||
    (!ratingDetails.service && !ratingDetails.logistics && !ratingDetails.quality)
  )

  if (needsAggregateFallback) {
    const summary = await computeWorkshopRatingSummary(workshopId)
    reviewCount = summary.review_count
    shopRating = summary.shop_rating
    ratingDetails = summary.rating_details
  }

  return {
    success: true,
    list: (listRes.data || []).map((item) => sanitizeReviewDoc(item, {
      showSku: false,
      isWorkshopOwner
    })),
    page,
    page_size: pageSize,
    has_more: skip + (listRes.data || []).length < (countRes.total || 0),
    is_workshop_owner: isWorkshopOwner,
    summary: {
      review_count: reviewCount,
      shop_rating: reviewCount > 0 ? Number(shopRating.toFixed(1)) : 0,
      rating_details: ratingDetails
    }
  }
}

async function replyOnce(event, openid) {
  if (!openid) {
    throw new Error('请先登录后再回复')
  }

  const reviewId = getSafeString(event.review_id)
  if (!reviewId) {
    throw new Error('缺少评价信息')
  }

  const content = normalizeReplyContent(event.content)
  const currentUser = await getCurrentUser(openid)
  const transaction = await db.startTransaction()

  try {
    const reviewRes = await transaction.collection('shopping_reviews').doc(reviewId).get()
    const review = reviewRes.data
    if (!review) {
      throw new Error('评价不存在')
    }

    const workshopRes = await transaction.collection('shopping_workshops').doc(review.workshop_id).get()
    const workshop = workshopRes.data
    if (!workshop) {
      throw new Error('工坊不存在')
    }

    if (getWorkshopOwnerOpenid(workshop) !== openid) {
      throw new Error('仅工坊主可回复评价')
    }

    if (review.seller_reply && getSafeString(review.seller_reply.content)) {
      throw new Error('该评价已回复，不能再次修改')
    }

    const sellerName = getSafeString(workshop.name) || getSafeString(currentUser && currentUser.nickname) || '工坊回复'
    await transaction.collection('shopping_reviews').doc(reviewId).update({
      data: {
        seller_reply: {
          content,
          reply_time: db.serverDate(),
          seller_openid: openid,
          seller_name: sellerName
        }
      }
    })

    await transaction.commit()

    const latestReviewRes = await db.collection('shopping_reviews').doc(reviewId).get()
    return {
      success: true,
      message: '回复成功',
      review: sanitizeReviewDoc(latestReviewRes.data, {
        showSku: false,
        isWorkshopOwner: true
      })
    }
  } catch (err) {
    await transaction.rollback().catch(() => {})
    throw err
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = getSafeString(event.action)

  try {
    switch (action) {
      case 'submit':
        return await submit(event, OPENID)
      case 'submit_auto':
        return await submitAuto(event)
      case 'get_detail':
        return await getDetail(event, OPENID)
      case 'list_product':
        return await listProduct(event)
      case 'list_workshop':
        return await listWorkshop(event, OPENID)
      case 'reply_once':
        return await replyOnce(event, OPENID)
      default:
        return {
          success: false,
          message: '不支持的操作类型'
        }
    }
  } catch (err) {
    console.error('[manage_review]', err)
    return {
      success: false,
      message: err.message || '评价操作失败'
    }
  }
}
