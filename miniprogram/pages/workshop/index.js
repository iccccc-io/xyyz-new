const app = getApp()
const db = wx.cloud.database()
const _ = db.command
const { createProductSummary } = require('../../common/mall-sku')
const { decorateReview, formatScoreValue } = require('../../common/review')

const DEFAULT_WORKSHOP_COVER = '/images/default-goods-image.png'
const WORKSHOP_TABS = [
  { key: 'products', label: '全部作品' },
  { key: 'notes', label: '匠心动态' },
  { key: 'reviews', label: '客户评价' }
]
const PRODUCT_MEDIA_HEIGHTS = [324, 360, 336, 372]
const NOTE_MEDIA_HEIGHTS = [232, 272, 248, 286]
const REVIEW_PAGE_SIZE = 10

function getSafeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function getSafeNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function padNumber(value) {
  return String(value).padStart(2, '0')
}

function formatShortDate(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${padNumber(date.getMonth() + 1)}月${padNumber(date.getDate())}日`
}

function formatCompactCount(value) {
  const count = Math.max(0, Math.floor(getSafeNumber(value, 0)))
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1).replace(/\.0$/, '')}万`
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}千`
  }
  return String(count)
}

function estimateTextLines(text, perLine, maxLines) {
  const content = getSafeString(text)
  if (!content) return 0
  return Math.max(1, Math.min(maxLines, Math.ceil(content.length / perLine)))
}

function buildChatRoomId(currentOpenid, ownerOpenid) {
  return [getSafeString(currentOpenid), getSafeString(ownerOpenid)]
    .filter(Boolean)
    .sort()
    .join('_')
}

function getWorkshopOwnerOpenid(workshop) {
  return getSafeString(workshop && (workshop.owner_openid || workshop.owner_id))
}

function normalizeWorkshopTags(workshop) {
  const rawTags = Array.isArray(workshop && workshop.workshop_tags)
    ? workshop.workshop_tags.map((item) => getSafeString(item)).filter(Boolean)
    : []
  const fallbackTags = [getSafeString(workshop && workshop.ich_category) || '非遗工坊']
  const tags = rawTags.length ? rawTags : fallbackTags
  return [...new Set(tags)].slice(0, 4)
}

function normalizeRatingDetails(details, reviewCount = 0) {
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

function buildWorkshopView(workshop, ownerUser, extra = {}) {
  const ownerStats = ownerUser && ownerUser.stats ? ownerUser.stats : {}
  const ownerOpenid = getWorkshopOwnerOpenid(workshop)
  const reviewCount = Math.max(0, Math.floor(getSafeNumber(extra.review_count, workshop.shop_review_count || 0)))
  const shopRating = getSafeNumber(extra.shop_rating, getSafeNumber(workshop.shop_rating, getSafeNumber(workshop.rating, 0)))
  const ratingValue = Number(shopRating.toFixed(1))
  const ratingDetails = normalizeRatingDetails(extra.rating_details || workshop.rating_details, reviewCount)
  const followCount = Math.max(0, Math.floor(getSafeNumber(extra.followCount, ownerStats.followers || 0)))
  const likeCount = Math.max(
    0,
    Math.floor(
      getSafeNumber(
        extra.likeCount,
        getSafeNumber(ownerStats.likes, 0) + getSafeNumber(ownerStats.collections, 0)
      )
    )
  )
  const ownerAvatar = getSafeString(workshop.logo) || getSafeString(
    ownerUser && (ownerUser.avatar_url || ownerUser.avatar_file_id || ownerUser.avatar)
  ) || DEFAULT_WORKSHOP_COVER
  const coverUrl = getSafeString(workshop.cover_url)
  const coverImage = coverUrl || ownerAvatar || DEFAULT_WORKSHOP_COVER
  const displayName = getSafeString(workshop.name) || `${getSafeString(workshop.real_name) || '匠人'}的非遗工坊`
  const ownerName = getSafeString(workshop.real_name) || getSafeString(ownerUser && ownerUser.nickname) || '工坊主理人'

  return {
    ...workshop,
    name: displayName,
    owner_openid: ownerOpenid,
    owner_name: ownerName,
    owner_avatar: ownerAvatar,
    coverImage,
    coverIsFallback: !coverUrl,
    tagsDisplay: normalizeWorkshopTags(workshop),
    descDisplay: getSafeString(workshop.desc) || '把一针一线、一刀一刻的手作心意，慢慢讲给你听。',
    followCount,
    likeCount,
    followCountText: formatCompactCount(followCount),
    likeCountText: formatCompactCount(likeCount),
    reviewCount,
    reviewCountText: formatCompactCount(reviewCount),
    ratingValueText: reviewCount > 0 ? ratingValue.toFixed(1) : '暂无',
    ratingDisplay: formatScoreValue(shopRating, reviewCount),
    reviewSummaryText: reviewCount > 0 ? `综合评分 ${ratingValue.toFixed(1)}` : '暂无评分',
    rating_details: ratingDetails,
    reviewMetricList: [
      { key: 'service', label: '服务', valueText: reviewCount > 0 ? ratingDetails.service.toFixed(1) : '暂无' },
      { key: 'logistics', label: '物流', valueText: reviewCount > 0 ? ratingDetails.logistics.toFixed(1) : '暂无' },
      { key: 'quality', label: '质量', valueText: reviewCount > 0 ? ratingDetails.quality.toFixed(1) : '暂无' }
    ]
  }
}

function normalizePostImages(images) {
  return (Array.isArray(images) ? images : [])
    .map((item) => {
      if (typeof item === 'string') return item
      return getSafeString(item && item.url)
    })
    .filter(Boolean)
}

function createExcerpt(content, title) {
  const text = getSafeString(content).replace(/\s+/g, ' ')
  if (text) {
    return text.slice(0, 58)
  }
  return getSafeString(title) || '记录一段工艺背后的温度与日常。'
}

function buildWaterfallColumns(list) {
  const left = []
  const right = []
  let leftHeight = 0
  let rightHeight = 0

  ;(list || []).forEach((item) => {
    if (leftHeight <= rightHeight) {
      left.push(item)
      leftHeight += getSafeNumber(item.cardHeightRpx, 0) + 18
    } else {
      right.push(item)
      rightHeight += getSafeNumber(item.cardHeightRpx, 0) + 18
    }
  })

  return {
    left,
    right,
    maxHeightRpx: Math.max(leftHeight, rightHeight, 520)
  }
}

function buildProductCard(item, index) {
  const summary = createProductSummary(item)
  const mediaHeight = PRODUCT_MEDIA_HEIGHTS[index % PRODUCT_MEDIA_HEIGHTS.length]
  const title = getSafeString(summary.title) || '非遗作品'
  const titleLines = estimateTextLines(title, 11, 2)

  return {
    ...summary,
    mediaHeight,
    cardHeightRpx: mediaHeight + 214 + (titleLines - 1) * 38,
    badgeText: getSafeString(summary.related_project_name) || getSafeString(summary.category) || '非遗文创',
    displaySales: formatCompactCount(summary.sales || 0)
  }
}

function buildNoteCard(post, index) {
  const images = normalizePostImages(post.images)
  const cover = images[0] || ''
  const mediaHeight = cover ? NOTE_MEDIA_HEIGHTS[index % NOTE_MEDIA_HEIGHTS.length] : 0
  const title = getSafeString(post.title) || '主理人手记'
  const excerpt = createExcerpt(post.content, title)
  const titleLines = estimateTextLines(title, 11, 2)
  const excerptLines = estimateTextLines(excerpt, cover ? 12 : 11, cover ? 3 : 5)
  const footerHeight = 112
  const textBlockHeight = 112 + (titleLines - 1) * 42 + (excerptLines - 1) * 32

  return {
    ...post,
    cover,
    mediaHeight,
    excerpt,
    timeText: formatShortDate(post.create_time),
    likesText: formatCompactCount(post.likes || 0),
    commentsText: formatCompactCount(post.comment_count || 0),
    tagText: getSafeString(post.related_projects && post.related_projects[0] && post.related_projects[0].name)
      || getSafeString(post.tags && post.tags[0]),
    cardHeightRpx: (cover ? mediaHeight : 56) + textBlockHeight + footerHeight
  }
}

function estimateReviewCardHeight(review) {
  let total = 232
  const contentLines = estimateTextLines(review && review.content, 16, 6)
  const replyLines = estimateTextLines(review && review.seller_reply && review.seller_reply.content, 16, 5)
  const imageRows = Math.ceil(((review && review.images && review.images.length) || 0) / 3)

  if (contentLines > 0) total += contentLines * 34
  if (imageRows > 0) total += imageRows * 170
  if (review && review.seller_reply) total += 108 + replyLines * 30
  return total
}

function calcReviewPaneHeightRpx(list, hasMore) {
  if (!Array.isArray(list) || !list.length) return 560
  const cardsHeight = list.reduce((sum, item, index) => sum + estimateReviewCardHeight(item) + (index > 0 ? 20 : 0), 0)
  return 280 + cardsHeight + (hasMore ? 88 : 0)
}

function getFileExtension(path) {
  const match = String(path || '').match(/(\.[a-zA-Z0-9]+)(?:$|\?)/)
  return match ? match[1].toLowerCase() : '.jpg'
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 64,
    safeAreaBottom: 0,
    navSolid: false,

    workshopId: '',
    workshopInfo: null,
    ownerUser: null,
    isOwner: false,
    isFollowing: false,

    pageLoading: true,
    activeTab: 0,
    tabList: WORKSHOP_TABS,
    swiperHeight: 420,

    products: [],
    leftProducts: [],
    rightProducts: [],
    productPaneHeightRpx: 560,

    notes: [],
    leftNotes: [],
    rightNotes: [],
    notePaneHeightRpx: 560,

    reviews: [],
    reviewLoading: false,
    reviewPage: 1,
    reviewHasMore: false,
    reviewPaneHeightRpx: 560,

    showReplyPopup: false,
    replyReviewId: '',
    replyContent: '',
    coverUploading: false
  },

  onLoad(options) {
    const systemInfo = wx.getSystemInfoSync()
    this._rpxRatio = systemInfo.windowWidth / 750
    this.setData({
      statusBarHeight: systemInfo.statusBarHeight || 20,
      navBarHeight: (systemInfo.statusBarHeight || 20) + 44,
      safeAreaBottom: systemInfo.safeArea ? (systemInfo.screenHeight - systemInfo.safeArea.bottom) : 0
    })

    if (options.id) {
      this.setData({ workshopId: options.id })
      this.loadWorkshopData()
    } else {
      this.loadUserWorkshop()
    }
  },

  async ensureCurrentUser() {
    let openid = getSafeString(app.globalData.openid)
    let userInfo = app.globalData.userInfo || null

    if (!openid) {
      try {
        const loginRes = await wx.cloud.callFunction({ name: 'login_get_openid' })
        openid = getSafeString(loginRes && loginRes.result && loginRes.result.openid)
        if (openid) {
          app.globalData.openid = openid
        }
      } catch (err) {}
    }

    if (openid && !userInfo) {
      try {
        const userRes = await db.collection('users')
          .where({ _openid: openid })
          .limit(1)
          .get()
        userInfo = userRes.data && userRes.data.length ? userRes.data[0] : null
        if (userInfo) {
          app.globalData.userInfo = userInfo
        }
      } catch (err) {}
    }

    return {
      openid,
      userInfo
    }
  },

  async loadUserWorkshop() {
    const session = await this.ensureCurrentUser()
    if (!session.openid) {
      app.requireLogin('/pages/workshop/index')
      return
    }

    const userInfo = session.userInfo || {}
    if (userInfo.workshop_id) {
      this.setData({ workshopId: userInfo.workshop_id })
      await this.loadWorkshopData()
      return
    }

    try {
      let workshopRes = await db.collection('shopping_workshops')
        .where({ owner_openid: session.openid })
        .limit(1)
        .get()

      if (!(workshopRes.data && workshopRes.data.length)) {
        workshopRes = await db.collection('shopping_workshops')
          .where({ owner_id: session.openid })
          .limit(1)
          .get()
      }

      if (workshopRes.data && workshopRes.data.length) {
        this.setData({ workshopId: workshopRes.data[0]._id })
        await this.loadWorkshopData()
        return
      }
    } catch (err) {}

    this.setData({ pageLoading: false })
    wx.showModal({
      title: '提示',
      content: '您还没有创建工坊',
      confirmText: '去认证',
      success: (res) => {
        if (res.confirm) {
          wx.redirectTo({
            url: '/pages/certification/apply'
          })
        } else {
          this.goBack()
        }
      }
    })
  },

  async loadWorkshopData() {
    const workshopId = this.data.workshopId
    if (!workshopId) return

    this.setData({
      pageLoading: true,
      showReplyPopup: false
    })

    try {
      const session = await this.ensureCurrentUser()
      const workshopRes = await db.collection('shopping_workshops').doc(workshopId).get()
      const workshop = workshopRes.data

      if (!workshop) {
        this.setData({
          pageLoading: false,
          workshopInfo: null
        })
        return
      }

      this._rawWorkshop = workshop
      const ownerOpenid = getWorkshopOwnerOpenid(workshop)
      const isOwner = Boolean(session.openid && ownerOpenid && session.openid === ownerOpenid)

      const [ownerUser, followCountRes] = await Promise.all([
        this.loadOwnerUser(ownerOpenid),
        ownerOpenid
          ? db.collection('community_follows').where({ target_id: ownerOpenid }).count().catch(() => ({ total: 0 }))
          : Promise.resolve({ total: 0 })
      ])

      const workshopInfo = buildWorkshopView(workshop, ownerUser, {
        followCount: followCountRes.total || 0
      })

      this.setData({
        workshopInfo,
        ownerUser,
        isOwner,
        isFollowing: false
      })

      if (session.openid && ownerOpenid && !isOwner) {
        await this.checkFollowStatus(session.openid, ownerOpenid)
      }

      await Promise.all([
        this.loadProducts(),
        this.loadOwnerNotes(),
        this.loadWorkshopReviews(true)
      ])

      this.setData({ pageLoading: false })
      this.updateSwiperHeight(this.data.activeTab)
    } catch (err) {
      console.error('[workshop] loadWorkshopData failed:', err)
      this.setData({
        pageLoading: false,
        workshopInfo: null
      })
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    }
  },

  async loadOwnerUser(ownerOpenid) {
    const openid = getSafeString(ownerOpenid)
    if (!openid) return null

    try {
      const userRes = await db.collection('users')
        .where({ _openid: openid })
        .limit(1)
        .get()
      return userRes.data && userRes.data.length ? userRes.data[0] : null
    } catch (err) {
      return null
    }
  },

  async checkFollowStatus(currentOpenid, ownerOpenid) {
    try {
      const followRes = await db.collection('community_follows')
        .where({
          follower_id: currentOpenid,
          target_id: ownerOpenid
        })
        .limit(1)
        .get()

      this.setData({
        isFollowing: Boolean(followRes.data && followRes.data.length)
      })
    } catch (err) {
      this.setData({ isFollowing: false })
    }
  },

  updateWorkshopView(extra = {}) {
    if (!this._rawWorkshop) return
    const currentInfo = this.data.workshopInfo || {}
    const mergedWorkshop = {
      ...this._rawWorkshop,
      cover_url: extra.cover_url != null ? extra.cover_url : this._rawWorkshop.cover_url,
      shop_review_count: extra.review_count != null ? extra.review_count : this._rawWorkshop.shop_review_count,
      shop_rating: extra.shop_rating != null ? extra.shop_rating : this._rawWorkshop.shop_rating,
      rating: extra.shop_rating != null ? extra.shop_rating : this._rawWorkshop.rating,
      rating_details: extra.rating_details || this._rawWorkshop.rating_details
    }
    const nextWorkshopInfo = buildWorkshopView(mergedWorkshop, this.data.ownerUser, {
      followCount: extra.followCount != null ? extra.followCount : currentInfo.followCount,
      likeCount: extra.likeCount != null ? extra.likeCount : currentInfo.likeCount,
      review_count: mergedWorkshop.shop_review_count,
      shop_rating: mergedWorkshop.shop_rating,
      rating_details: mergedWorkshop.rating_details
    })

    this._rawWorkshop = mergedWorkshop

    this.setData({ workshopInfo: nextWorkshopInfo })
  },

  async loadProducts() {
    try {
      const whereCondition = { workshop_id: this.data.workshopId }
      if (!this.data.isOwner) {
        whereCondition.status = 1
        whereCondition.total_stock = _.gt(0)
        whereCondition.is_on_sale = true
      }

      const productRes = await db.collection('shopping_products')
        .where(whereCondition)
        .orderBy('create_time', 'desc')
        .get()

      const products = (productRes.data || []).map((item, index) => buildProductCard(item, index))
      const columns = buildWaterfallColumns(products)

      this.setData({
        products,
        leftProducts: columns.left,
        rightProducts: columns.right,
        productPaneHeightRpx: columns.maxHeightRpx + 36
      })
      this.updateSwiperHeight(this.data.activeTab)
    } catch (err) {
      console.error('[workshop] loadProducts failed:', err)
      this.setData({
        products: [],
        leftProducts: [],
        rightProducts: [],
        productPaneHeightRpx: 560
      })
    }
  },

  async loadOwnerNotes() {
    const workshopInfo = this.data.workshopInfo
    const ownerOpenid = getSafeString(workshopInfo && workshopInfo.owner_openid)
    if (!ownerOpenid) {
      this.setData({
        notes: [],
        leftNotes: [],
        rightNotes: [],
        notePaneHeightRpx: 560
      })
      return
    }

    try {
      const notesRes = await db.collection('community_posts')
        .where({
          _openid: ownerOpenid,
          status: 0
        })
        .orderBy('create_time', 'desc')
        .limit(20)
        .get()

      const notes = (notesRes.data || []).map((item, index) => buildNoteCard(item, index))
      const columns = buildWaterfallColumns(notes)
      const likesFromNotes = notes.reduce((sum, item) => sum + Math.max(0, Math.floor(getSafeNumber(item.likes, 0))), 0)

      this.setData({
        notes,
        leftNotes: columns.left,
        rightNotes: columns.right,
        notePaneHeightRpx: columns.maxHeightRpx + 152
      })

      if (likesFromNotes > getSafeNumber(this.data.workshopInfo && this.data.workshopInfo.likeCount, 0)) {
        this.updateWorkshopView({ likeCount: likesFromNotes })
      }

      this.updateSwiperHeight(this.data.activeTab)
    } catch (err) {
      console.error('[workshop] loadOwnerNotes failed:', err)
      this.setData({
        notes: [],
        leftNotes: [],
        rightNotes: [],
        notePaneHeightRpx: 560
      })
    }
  },

  async loadWorkshopReviews(reset = false) {
    if (!this.data.workshopId) return
    if (this.data.reviewLoading && !reset) return

    const nextPage = reset ? 1 : this.data.reviewPage + 1
    this.setData({ reviewLoading: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_review',
        data: {
          action: 'list_workshop',
          workshop_id: this.data.workshopId,
          page: nextPage,
          page_size: REVIEW_PAGE_SIZE
        }
      })

      const result = res.result
      if (!(result && result.success)) {
        throw new Error((result && result.message) || '加载评价失败')
      }

      const incomingReviews = (result.list || []).map((item) => decorateReview(item, { showProductTitle: true }))
      const reviews = reset ? incomingReviews : [...this.data.reviews, ...incomingReviews]
      const summary = result.summary || {}

      this.setData({
        reviews,
        reviewPage: nextPage,
        reviewHasMore: result.has_more === true,
        reviewLoading: false,
        isOwner: result.is_workshop_owner === true || this.data.isOwner,
        reviewPaneHeightRpx: calcReviewPaneHeightRpx(reviews, result.has_more === true)
      })

      this.updateWorkshopView({
        review_count: summary.review_count,
        shop_rating: summary.shop_rating,
        rating_details: summary.rating_details
      })
      this.updateSwiperHeight(this.data.activeTab)
    } catch (err) {
      console.error('[workshop] loadWorkshopReviews failed:', err)
      this.setData({ reviewLoading: false })
      if (reset) {
        this.setData({
          reviews: [],
          reviewPage: 1,
          reviewHasMore: false,
          reviewPaneHeightRpx: 560
        })
      }
    }
  },

  updateSwiperHeight(tabIndex = this.data.activeTab) {
    const activeKey = WORKSHOP_TABS[tabIndex] ? WORKSHOP_TABS[tabIndex].key : 'products'
    let heightRpx = 560

    if (activeKey === 'products') {
      heightRpx = Math.max(560, Math.floor(getSafeNumber(this.data.productPaneHeightRpx, 560)))
    } else if (activeKey === 'notes') {
      heightRpx = Math.max(560, Math.floor(getSafeNumber(this.data.notePaneHeightRpx, 560)))
    } else if (activeKey === 'reviews') {
      heightRpx = Math.max(560, Math.floor(getSafeNumber(this.data.reviewPaneHeightRpx, 560)))
    }

    this.setData({
      swiperHeight: Math.ceil(heightRpx * (this._rpxRatio || 1))
    })
  },

  onTabTap(e) {
    const index = Number(e.currentTarget.dataset.index || 0)
    if (index === this.data.activeTab) return
    this.setData({ activeTab: index })
    this.updateSwiperHeight(index)
  },

  onSwiperChange(e) {
    const index = Number(e.detail.current || 0)
    if (index === this.data.activeTab) {
      this.updateSwiperHeight(index)
      return
    }
    this.setData({ activeTab: index })
    this.updateSwiperHeight(index)
  },

  onPageScroll(e) {
    const navSolid = e.scrollTop > 180
    if (navSolid !== this.data.navSolid) {
      this.setData({ navSolid })
    }
  },

  navigateToProductDetail(e) {
    const { id } = e.currentTarget.dataset
    if (!id) return
    wx.navigateTo({
      url: `/pages/mall/detail?id=${id}`
    })
  },

  navigateToPublish() {
    if (!this.data.isOwner) {
      wx.showToast({
        title: '仅工坊主可发布商品',
        icon: 'none'
      })
      return
    }

    wx.navigateTo({
      url: '/pages/product/publish'
    })
  },

  goToOwnerProfile() {
    const ownerOpenid = getSafeString(this.data.workshopInfo && this.data.workshopInfo.owner_openid)
    if (!ownerOpenid) return
    wx.navigateTo({
      url: `/pages/community/user-profile?userId=${ownerOpenid}`
    })
  },

  goToWorkshopEdit() {
    if (!this.data.isOwner || !this.data.workshopId) return
    wx.navigateTo({
      url: `/pages/workshop/edit-info?id=${this.data.workshopId}`
    })
  },

  goToNoteDetail(e) {
    const { id } = e.currentTarget.dataset
    if (!id) return
    wx.navigateTo({
      url: `/pages/community/detail?id=${id}`
    })
  },

  async toggleFollow() {
    const workshopInfo = this.data.workshopInfo
    const ownerOpenid = getSafeString(workshopInfo && workshopInfo.owner_openid)
    if (!ownerOpenid) {
      wx.showToast({
        title: '主理人信息缺失',
        icon: 'none'
      })
      return
    }

    if (!app.checkLogin()) {
      app.requireLogin(`/pages/workshop/index?id=${this.data.workshopId}`)
      return
    }

    const currentOpenid = getSafeString(app.globalData.openid)
    if (!currentOpenid) {
      wx.showToast({
        title: '请稍后重试',
        icon: 'none'
      })
      return
    }

    if (currentOpenid === ownerOpenid || this.data.isOwner) {
      wx.showToast({
        title: '不能关注自己的工坊',
        icon: 'none'
      })
      return
    }

    wx.showLoading({
      title: this.data.isFollowing ? '处理中...' : '关注中...',
      mask: true
    })

    try {
      if (this.data.isFollowing) {
        await db.collection('community_follows')
          .where({
            follower_id: currentOpenid,
            target_id: ownerOpenid
          })
          .remove()

        await Promise.all([
          db.collection('users').where({ _openid: ownerOpenid }).update({
            data: {
              'stats.followers': _.inc(-1)
            }
          }).catch(() => null),
          db.collection('users').where({ _openid: currentOpenid }).update({
            data: {
              'stats.following': _.inc(-1)
            }
          }).catch(() => null)
        ])

        if (app.globalData.userInfo && app.globalData.userInfo.stats) {
          app.globalData.userInfo.stats.following = Math.max(0, getSafeNumber(app.globalData.userInfo.stats.following, 0) - 1)
        }

        const nextFollowCount = Math.max(0, getSafeNumber(workshopInfo.followCount, 0) - 1)
        this.setData({ isFollowing: false })
        this.updateWorkshopView({ followCount: nextFollowCount })

        wx.hideLoading()
        wx.showToast({
          title: '已取消关注',
          icon: 'success'
        })
        return
      }

      await db.collection('community_follows').add({
        data: {
          follower_id: currentOpenid,
          target_id: ownerOpenid,
          create_time: db.serverDate()
        }
      })

      await Promise.all([
        db.collection('users').where({ _openid: ownerOpenid }).update({
          data: {
            'stats.followers': _.inc(1)
          }
        }).catch(() => null),
        db.collection('users').where({ _openid: currentOpenid }).update({
          data: {
            'stats.following': _.inc(1)
          }
        }).catch(() => null)
      ])

      if (app.globalData.userInfo && app.globalData.userInfo.stats) {
        app.globalData.userInfo.stats.following = getSafeNumber(app.globalData.userInfo.stats.following, 0) + 1
      }

      const nextFollowCount = getSafeNumber(workshopInfo.followCount, 0) + 1
      this.setData({ isFollowing: true })
      this.updateWorkshopView({ followCount: nextFollowCount })

      wx.hideLoading()
      wx.showToast({
        title: '关注成功',
        icon: 'success'
      })
    } catch (err) {
      wx.hideLoading()
      console.error('[workshop] toggleFollow failed:', err)
      wx.showToast({
        title: '操作失败',
        icon: 'none'
      })
    }
  },

  goToChat() {
    const workshopInfo = this.data.workshopInfo
    const ownerOpenid = getSafeString(workshopInfo && workshopInfo.owner_openid)
    if (!ownerOpenid) {
      wx.showToast({
        title: '主理人信息缺失',
        icon: 'none'
      })
      return
    }

    if (!app.checkLogin()) {
      app.requireLogin(`/pages/workshop/index?id=${this.data.workshopId}`)
      return
    }

    const currentOpenid = getSafeString(app.globalData.openid)
    if (!currentOpenid) {
      wx.showToast({
        title: '请稍后重试',
        icon: 'none'
      })
      return
    }

    if (currentOpenid === ownerOpenid || this.data.isOwner) {
      wx.showToast({
        title: '不能和自己聊天',
        icon: 'none'
      })
      return
    }

    const roomId = buildChatRoomId(currentOpenid, ownerOpenid)
    wx.navigateTo({
      url: `/pages/chat/room?targetUserId=${ownerOpenid}&room_id=${roomId}&source_scene=workshop`
    })
  },

  async changeCover() {
    if (!this.data.isOwner || this.data.coverUploading) return

    try {
      const chooseRes = await wx.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera']
      })

      const filePath = chooseRes.tempFilePaths && chooseRes.tempFilePaths[0]
      if (!filePath) return

      this.setData({ coverUploading: true })
      wx.showLoading({
        title: '上传封面中...',
        mask: true
      })

      const ext = getFileExtension(filePath)
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `workshop-covers/${this.data.workshopId}-${Date.now()}${ext}`,
        filePath
      })

      const saveRes = await wx.cloud.callFunction({
        name: 'manage_workshop_home',
        data: {
          action: 'update_cover',
          workshop_id: this.data.workshopId,
          cover_url: uploadRes.fileID
        }
      })

      const result = saveRes.result
      if (!(result && result.success)) {
        throw new Error((result && result.message) || '封面更新失败')
      }

      wx.hideLoading()
      this.setData({ coverUploading: false })
      this.updateWorkshopView({ cover_url: uploadRes.fileID })
      wx.showToast({
        title: '封面已更新',
        icon: 'success'
      })
    } catch (err) {
      wx.hideLoading()
      this.setData({ coverUploading: false })
      if (err && err.errMsg && err.errMsg.indexOf('cancel') > -1) {
        return
      }
      console.error('[workshop] changeCover failed:', err)
      wx.showToast({
        title: '上传失败',
        icon: 'none'
      })
    }
  },

  previewReviewImages(e) {
    const urls = Array.isArray(e.currentTarget.dataset.urls) ? e.currentTarget.dataset.urls : []
    const index = Number(e.currentTarget.dataset.index || 0)
    if (!urls.length) return

    wx.previewImage({
      urls,
      current: urls[index] || urls[0]
    })
  },

  loadMoreReviews() {
    if (!this.data.reviewHasMore || this.data.reviewLoading) return
    this.loadWorkshopReviews(false)
  },

  openReplyPopup(e) {
    if (!this.data.isOwner) return
    const reviewId = e.currentTarget.dataset.id
    if (!reviewId) return

    this.setData({
      showReplyPopup: true,
      replyReviewId: reviewId,
      replyContent: ''
    })
  },

  closeReplyPopup() {
    this.setData({
      showReplyPopup: false,
      replyReviewId: '',
      replyContent: ''
    })
  },

  onReplyInput(e) {
    this.setData({
      replyContent: e.detail.value
    })
  },

  async submitReply() {
    const reviewId = this.data.replyReviewId
    const content = getSafeString(this.data.replyContent)
    if (!reviewId) return

    if (!content) {
      wx.showToast({
        title: '请输入回复内容',
        icon: 'none'
      })
      return
    }

    wx.showLoading({
      title: '提交中...',
      mask: true
    })

    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_review',
        data: {
          action: 'reply_once',
          review_id: reviewId,
          content
        }
      })

      wx.hideLoading()
      const result = res.result
      if (!(result && result.success && result.review)) {
        wx.showToast({
          title: (result && result.message) || '回复失败',
          icon: 'none'
        })
        return
      }

      const nextReview = decorateReview(result.review, { showProductTitle: true })
      const reviews = this.data.reviews.map((item) => (item._id === nextReview._id ? nextReview : item))
      this.setData({
        reviews,
        showReplyPopup: false,
        replyReviewId: '',
        replyContent: '',
        reviewPaneHeightRpx: calcReviewPaneHeightRpx(reviews, this.data.reviewHasMore)
      })

      this.updateSwiperHeight(this.data.activeTab)
      wx.showToast({
        title: '回复成功',
        icon: 'success'
      })
    } catch (err) {
      wx.hideLoading()
      console.error('[workshop] submitReply failed:', err)
      wx.showToast({
        title: '回复失败',
        icon: 'none'
      })
    }
  },

  goBack() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({
          url: '/pages/mall/home'
        })
      }
    })
  },

  onShow() {
    if (this.data.workshopId && this._rawWorkshop) {
      this.loadWorkshopData()
    }
  },

  onReachBottom() {
    if (this.data.activeTab === 2) {
      this.loadMoreReviews()
    }
  },

  onPullDownRefresh() {
    if (!this.data.workshopId) {
      wx.stopPullDownRefresh()
      return
    }

    this.loadWorkshopData()
      .finally(() => {
        wx.stopPullDownRefresh()
      })
  },

  onShareAppMessage() {
    const workshopInfo = this.data.workshopInfo
    return {
      title: workshopInfo ? `${workshopInfo.name} · 湘韵遗珍` : '湘韵遗珍 · 非遗工坊',
      path: `/pages/workshop/index?id=${this.data.workshopId || ''}`,
      imageUrl: workshopInfo ? workshopInfo.coverImage : DEFAULT_WORKSHOP_COVER
    }
  }
})
