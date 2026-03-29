const app = getApp()
const db = wx.cloud.database()
const _ = db.command

const DEFAULT_AVATAR = '/images/icons/avatar.png'
const CONTENT_TABS = [
  { key: 'posts', label: '我的笔记' },
  { key: 'collections', label: '我的收藏' }
]
const PAGE_COPY = {
  loading: '正在整理你的个人中心',
  brand: '湘韵遗珍',
  pageTitle: '个人中心',
  wallet: '钱包',
  mall: '商城',
  service: '客服',
  login: '登录',
  creatorEyebrow: '传承人工坊',
  creatorDefaultName: '我的工坊',
  creatorDesc: '工坊经营入口已开启，商品发布、SKU 管理、履约与售后都从这里进入。',
  viewWorkshop: '查看工坊',
  upgradeEyebrow: '身份升级',
  upgradeTitle: '成为传承人后开通工坊经营',
  upgradeDesc: '当前账号默认为非遗爱好者。完成认证后，系统会为你自动创建工坊，并开放商品售卖能力。',
  upgradeCta: '申请成为传承人',
  guestEyebrow: '欢迎回来',
  guestTitle: '登录后解锁你的非遗档案',
  guestDesc: '查看订单、钱包、收藏与社区笔记，也可以在完成认证后开通自己的非遗工坊。',
  guestPrimary: '立即登录',
  guestSecondary: '先逛社区',
  ordersTitle: '我的订单',
  ordersDesc: '交易进度与售后状态都在这里查看',
  allOrders: '全部订单',
  servicesTitle: '常用服务',
  servicesDesc: '账户管理、平台服务与身份入口',
  contentTitle: '社区内容',
  contentDesc: '你的笔记与收藏会在这里持续累积',
  writeNote: '写笔记',
  goCommunity: '去社区',
  loadingContent: '正在整理内容',
  updatedNow: '刚刚更新'
}
const UPGRADE_BENEFITS = [
  '通过认证后自动开通专属工坊',
  '支持发布文创商品并管理 SKU',
  '可处理卖家订单与售后服务'
]

function createDefaultUserInfo() {
  return {
    nickname: '',
    avatar_url: '',
    avatar_file_id: '',
    avatar: '',
    profile_bg_url: '',
    bio: '',
    is_certified: false,
    certified_title: '',
    ich_category: '',
    workshop_id: '',
    stats: {
      following: 0,
      followers: 0,
      likes: 0,
      views: 0
    }
  }
}

function formatCount(value) {
  const num = Number(value) || 0
  if (num >= 10000) {
    return `${(num / 10000).toFixed(1).replace(/\.0$/, '')}w`
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1).replace(/\.0$/, '')}k`
  }
  return String(num)
}

function formatCurrencyFen(value) {
  const amount = Number(value) || 0
  return (amount / 100).toFixed(2)
}

function normalizeImageList(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') {
        return item.url || item.file_id || item.tempFilePath || ''
      }
      return ''
    })
    .filter(Boolean)
}

function formatPostDate(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}.${day}`
}

function normalizePost(item = {}) {
  const images = normalizeImageList(item.images)
  const relatedProjects = Array.isArray(item.related_projects) ? item.related_projects : []
  const authorInfo = item.author_info || {}

  return {
    ...item,
    images,
    coverImage: images[0] || '',
    likeCount: Number(item.likes) || 0,
    tagText: relatedProjects[0] && relatedProjects[0].name ? relatedProjects[0].name : '',
    authorName: authorInfo.nickname || '匿名用户',
    authorAvatar: authorInfo.avatar_file_id || authorInfo.avatar_url || authorInfo.avatar || DEFAULT_AVATAR,
    dateLabel: formatPostDate(item.create_time)
  }
}

function splitWaterfall(list) {
  const left = []
  const right = []

  ;(list || []).forEach((item, index) => {
    if (index % 2 === 0) {
      left.push(item)
    } else {
      right.push(item)
    }
  })

  return { left, right }
}

function getHeaderBackdrop(userInfo, posts) {
  if (userInfo && userInfo.profile_bg_url) return userInfo.profile_bg_url
  if (userInfo && (userInfo.avatar_url || userInfo.avatar_file_id || userInfo.avatar)) {
    return userInfo.avatar_url || userInfo.avatar_file_id || userInfo.avatar
  }
  return ''
}

function buildStatItems(userInfo) {
  const stats = userInfo.stats || {}
  return [
    {
      key: 'following',
      label: '关注',
      value: formatCount(stats.following),
      action: 'goToFollowing'
    },
    {
      key: 'followers',
      label: '粉丝',
      value: formatCount(stats.followers),
      action: 'goToFollowers'
    },
    {
      key: 'likes',
      label: '获赞',
      value: formatCount(stats.likes),
      action: ''
    },
    {
      key: 'views',
      label: '浏览',
      value: formatCount(stats.views),
      action: ''
    }
  ]
}

function buildOrderEntries(orderCounts) {
  return [
    {
      key: 'pending',
      label: '待付款',
      icon: 'balance-o',
      status: '10',
      count: orderCounts.pending || 0,
      tone: 'tone-red'
    },
    {
      key: 'toShip',
      label: '待发货',
      icon: 'gift-o',
      status: '20',
      count: orderCounts.toShip || 0,
      tone: 'tone-amber'
    },
    {
      key: 'toReceive',
      label: '待收货',
      icon: 'logistics',
      status: '30',
      count: orderCounts.toReceive || 0,
      tone: 'tone-blue'
    },
    {
      key: 'completed',
      label: '已完成',
      icon: 'passed',
      status: '40',
      count: orderCounts.completed || 0,
      tone: 'tone-emerald'
    },
    {
      key: 'refund',
      label: '售后',
      icon: 'service-o',
      status: '60',
      count: orderCounts.refund || 0,
      tone: 'tone-ink'
    }
  ]
}

function buildCreatorMetrics(workshopData, pendingOrders) {
  return [
    {
      label: '在售商品',
      value: formatCount(workshopData && workshopData.product_count)
    },
    {
      label: '累计销量',
      value: formatCount(workshopData && workshopData.total_sales)
    },
    {
      label: '待发货',
      value: formatCount(pendingOrders),
      highlight: pendingOrders > 0
    }
  ]
}

function buildCreatorActions(pendingOrders) {
  return [
    {
      key: 'publish',
      title: '发布商品',
      desc: '上新文创好物',
      icon: 'plus',
      action: 'goToPublish',
      tone: 'tone-red'
    },
    {
      key: 'manage',
      title: '商品管理',
      desc: '维护价格与库存',
      icon: 'orders-o',
      action: 'goToProductManage',
      tone: 'tone-ink'
    },
    {
      key: 'sellerOrders',
      title: '卖家订单',
      desc: '查看履约进度',
      icon: 'logistics',
      action: 'goToSellerOrders',
      tone: 'tone-amber',
      badge: pendingOrders > 0 ? String(pendingOrders) : ''
    },
    {
      key: 'aftersale',
      title: '售后处理',
      desc: '退款退货协同',
      icon: 'service-o',
      action: 'goToAftersaleCenter',
      tone: 'tone-emerald'
    }
  ]
}

function buildServiceGroups(isLoggedIn, userInfo, walletBalance) {
  if (!isLoggedIn) {
    return [
      {
        key: 'guest-main',
        title: '开始使用',
        items: [
          {
            title: '立即登录',
            desc: '同步订单、收藏与社区内容',
            icon: 'friends-o',
            action: 'goToLogin',
            tone: 'tone-red'
          },
          {
            title: '去逛文创商城',
            desc: '看看最新非遗好物',
            icon: 'shop-o',
            action: 'goToMall',
            tone: 'tone-amber'
          }
        ]
      },
      {
        key: 'guest-service',
        title: '平台服务',
        items: [
          {
            title: '联系客服',
            desc: '问题反馈与使用帮助',
            icon: 'service-o',
            action: 'contactService',
            tone: 'tone-ink'
          }
        ]
      }
    ]
  }

  const identityItem = userInfo.is_certified
    ? {
        title: '我的工坊',
        desc: userInfo.workshop_id ? '查看工坊主页与经营状态' : '工坊数据同步中',
        icon: 'shop-o',
        action: 'goToMyWorkshop',
        tone: 'tone-amber'
      }
    : {
        title: '传承人认证',
        desc: '认证后可开通工坊并售卖商品',
        icon: 'certificate',
        action: 'goToCertify',
        tone: 'tone-red'
      }

  return [
    {
      key: 'account',
      title: '账户与交易',
      items: [
        {
          title: '我的钱包',
          desc: walletBalance !== null ? `当前余额 ¥${walletBalance}` : '管理余额与支付密码',
          icon: 'gold-coin-o',
          action: 'goToWallet',
          tone: 'tone-red'
        },
        {
          title: '收货地址',
          desc: '统一管理下单收货信息',
          icon: 'location-o',
          action: 'goToAddress',
          tone: 'tone-blue'
        },
        identityItem
      ]
    },
    {
      key: 'service',
      title: '更多服务',
      items: [
        {
          title: '非遗足迹',
          desc: '查看近期浏览与互动记录',
          icon: 'guide-o',
          action: 'goToFootprint',
          tone: 'tone-emerald'
        },
        {
          title: '联系客服',
          desc: '问题反馈与使用帮助',
          icon: 'service-o',
          action: 'contactService',
          tone: 'tone-ink'
        },
        {
          title: '退出登录',
          desc: '安全退出当前账号',
          icon: 'revoke',
          action: 'onLogout',
          tone: 'tone-gray',
          danger: true
        }
      ]
    }
  ]
}

Page({
  data: {
    statusBarHeight: 20,
    safeAreaBottom: 0,
    pageLoading: true,
    isLoggedIn: false,
    userInfo: createDefaultUserInfo(),
    walletBalance: null,
    orderCounts: {
      pending: 0,
      toShip: 0,
      toReceive: 0,
      completed: 0,
      refund: 0
    },
    workshopData: null,
    workshopPendingOrders: 0,
    userPosts: [],
    leftPosts: [],
    rightPosts: [],
    collectedPosts: [],
    leftCollectedPosts: [],
    rightCollectedPosts: [],
    collectionsLoading: false,
    collectionsLoaded: false,
    activeTabKey: 'posts',
    contentTabs: CONTENT_TABS,
    copy: PAGE_COPY,
    displayName: '访客模式',
    profileBio: '在湘韵遗珍记录你的非遗灵感、订单与工坊成长。',
    statItems: [],
    orderEntries: [],
    serviceGroups: [],
    creatorMetrics: [],
    creatorActions: [],
    showCreatorCard: false,
    showUpgradeCard: false,
    showGuestCard: true,
    headerBackdrop: '',
    displayLeftPosts: [],
    displayRightPosts: [],
    contentLoading: false,
    uploadingHeroCover: false,
    contentEmptyTitle: '登录后查看你的个人内容',
    contentEmptyDesc: '发布社区笔记、收藏灵感内容，都会在这里集中呈现。',
    contentEmptyActionText: '立即登录',
    contentEmptyAction: 'goToLogin',
    upgradeBenefits: UPGRADE_BENEFITS
  },

  onLoad() {
    const systemInfo = wx.getSystemInfoSync()
    this.setData({
      statusBarHeight: systemInfo.statusBarHeight || 20,
      safeAreaBottom: systemInfo.safeArea ? (systemInfo.screenHeight - systemInfo.safeArea.bottom) : 0
    })

    this.refreshPageData()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateActive(4)
    }

    if (this._pageReady) {
      this.refreshPageData({ silent: true })

      if (this.data.isLoggedIn && this.data.activeTabKey === 'collections' && this.data.collectionsLoaded) {
        this.setData({ collectionsLoaded: false }, () => {
          this.loadUserCollections()
        })
      }
    }
  },

  async refreshPageData({ silent = false } = {}) {
    const globalUser = app.globalData.userInfo
    const currentUserKey = globalUser ? (globalUser._openid || app.globalData.openid || globalUser._id || '') : ''
    const userChanged = currentUserKey !== this._userKey
    this._userKey = currentUserKey

    if (!silent || !this._pageReady) {
      this.setData({ pageLoading: true })
    }

    if (!globalUser) {
      this._pageReady = true
      this.setData({
        isLoggedIn: false,
        userInfo: createDefaultUserInfo(),
        walletBalance: null,
        orderCounts: {
          pending: 0,
          toShip: 0,
          toReceive: 0,
          completed: 0,
          refund: 0
        },
        workshopData: null,
        workshopPendingOrders: 0,
        userPosts: [],
        leftPosts: [],
        rightPosts: [],
        collectedPosts: [],
        leftCollectedPosts: [],
        rightCollectedPosts: [],
        collectionsLoading: false,
        collectionsLoaded: false,
        pageLoading: false
      }, () => {
        this.refreshViewModel()
      })
      return
    }

    const userInfo = {
      ...createDefaultUserInfo(),
      ...globalUser,
      stats: {
        ...createDefaultUserInfo().stats,
        ...(globalUser.stats || {})
      }
    }
    const openid = app.globalData.openid || globalUser._openid || ''

    try {
      const [orderCounts, postPayload, walletBalance, workshopPayload] = await Promise.all([
        this.fetchOrderCounts(openid),
        this.fetchUserPosts(openid),
        this.fetchWalletBalance(openid),
        userInfo.is_certified && userInfo.workshop_id
          ? this.fetchWorkshopSummary(userInfo.workshop_id)
          : Promise.resolve({ workshopData: null, workshopPendingOrders: 0 })
      ])

      const nextState = {
        isLoggedIn: true,
        userInfo,
        walletBalance,
        orderCounts,
        workshopData: workshopPayload.workshopData,
        workshopPendingOrders: workshopPayload.workshopPendingOrders,
        userPosts: postPayload.userPosts,
        leftPosts: postPayload.leftPosts,
        rightPosts: postPayload.rightPosts,
        pageLoading: false
      }

      if (userChanged) {
        nextState.collectedPosts = []
        nextState.leftCollectedPosts = []
        nextState.rightCollectedPosts = []
        nextState.collectionsLoaded = false
        nextState.collectionsLoading = false
      }

      this._pageReady = true
      this.setData(nextState, () => {
        this.refreshViewModel()
        if (this.data.activeTabKey === 'collections' && !this.data.collectionsLoaded) {
          this.loadUserCollections()
        }
      })
    } catch (err) {
      console.error('刷新个人中心失败:', err)
      this._pageReady = true
      this.setData({ pageLoading: false }, () => {
        this.refreshViewModel()
      })
      wx.showToast({
        title: '加载失败，请稍后重试',
        icon: 'none'
      })
    }
  },

  refreshViewModel() {
    const {
      isLoggedIn,
      userInfo,
      walletBalance,
      workshopData,
      workshopPendingOrders,
      orderCounts,
      userPosts,
      leftPosts,
      rightPosts,
      collectedPosts,
      leftCollectedPosts,
      rightCollectedPosts,
      collectionsLoading,
      collectionsLoaded,
      activeTabKey
    } = this.data

    const showCreatorCard = Boolean(isLoggedIn && userInfo.is_certified)
    const showUpgradeCard = Boolean(isLoggedIn && !userInfo.is_certified)
    const showGuestCard = !isLoggedIn
    const displayName = isLoggedIn ? (userInfo.nickname || '未命名用户') : '访客模式'
    const profileBio = isLoggedIn
      ? ((userInfo.bio || '').trim() || (userInfo.is_certified
        ? '已完成传承人认证，工坊经营入口与卖家服务都在下方。'
        : '当前为爱好者身份，完成认证后即可开通工坊与商品售卖能力。'))
      : '在湘韵遗珍记录你的非遗灵感、订单与收藏，完整体验从登录开始。'
    const statItems = buildStatItems(userInfo)
    const orderEntries = buildOrderEntries(orderCounts)
    const serviceGroups = buildServiceGroups(isLoggedIn, userInfo, walletBalance)
    const creatorMetrics = buildCreatorMetrics(workshopData, workshopPendingOrders)
    const creatorActions = buildCreatorActions(workshopPendingOrders)
    const headerBackdrop = getHeaderBackdrop(userInfo, userPosts)
    const contentTabs = CONTENT_TABS.map((item) => {
      const count = item.key === 'posts'
        ? userPosts.length
        : (collectionsLoaded ? collectedPosts.length : 0)
      return {
        ...item,
        countText: count > 0 ? formatCount(count) : ''
      }
    })

    let displayLeft = leftPosts
    let displayRight = rightPosts
    let contentLoading = false
    let contentEmptyTitle = isLoggedIn ? '还没有发布笔记' : '登录后查看你的个人内容'
    let contentEmptyDesc = isLoggedIn
      ? '从一篇游记、一张照片开始，记录你的非遗灵感。'
      : '发布社区笔记、收藏灵感内容，都会在这里集中呈现。'
    let contentEmptyActionText = isLoggedIn ? '去写第一篇' : '立即登录'
    let contentEmptyAction = isLoggedIn ? 'goToPost' : 'goToLogin'

    if (activeTabKey === 'collections') {
      displayLeft = leftCollectedPosts
      displayRight = rightCollectedPosts
      contentLoading = isLoggedIn && collectionsLoading
      contentEmptyTitle = isLoggedIn ? '还没有收藏内容' : '登录后查看你的收藏'
      contentEmptyDesc = isLoggedIn
        ? '去社区或商城逛逛，把喜欢的内容留在这里。'
        : '登录后可同步你的灵感收藏与内容偏好。'
      contentEmptyActionText = isLoggedIn ? '去社区看看' : '立即登录'
      contentEmptyAction = isLoggedIn ? 'goToCommunity' : 'goToLogin'
    }

    this.setData({
      showCreatorCard,
      showUpgradeCard,
      showGuestCard,
      displayName,
      profileBio,
      statItems,
      orderEntries,
      serviceGroups,
      creatorMetrics,
      creatorActions,
      headerBackdrop,
      contentTabs,
      displayLeftPosts: displayLeft,
      displayRightPosts: displayRight,
      contentLoading,
      contentEmptyTitle,
      contentEmptyDesc,
      contentEmptyActionText,
      contentEmptyAction
    })
  },

  async fetchOrderCounts(openid) {
    if (!openid) {
      return {
        pending: 0,
        toShip: 0,
        toReceive: 0,
        completed: 0,
        refund: 0
      }
    }

    const res = await db.collection('shopping_orders')
      .where({ _openid: openid })
      .field({ status: true })
      .get()

    const orders = res.data || []
    return {
      pending: orders.filter((item) => item.status === 10).length,
      toShip: orders.filter((item) => item.status === 20).length,
      toReceive: orders.filter((item) => item.status === 30).length,
      completed: orders.filter((item) => item.status === 40).length,
      refund: orders.filter((item) => item.status === 60).length
    }
  },

  async fetchWorkshopSummary(workshopId) {
    if (!workshopId) {
      return {
        workshopData: null,
        workshopPendingOrders: 0
      }
    }

    const [workshopRes, pendingRes] = await Promise.all([
      db.collection('shopping_workshops').doc(workshopId).get().catch(() => ({ data: null })),
      db.collection('shopping_orders')
        .where({
          'product_snapshot.workshop_id': workshopId,
          status: 20
        })
        .count()
        .catch(() => ({ total: 0 }))
    ])

    return {
      workshopData: workshopRes.data || null,
      workshopPendingOrders: pendingRes.total || 0
    }
  },

  async fetchUserPosts(openid) {
    if (!openid) {
      return {
        userPosts: [],
        leftPosts: [],
        rightPosts: []
      }
    }

    const postsRes = await db.collection('community_posts')
      .where({ _openid: openid })
      .orderBy('create_time', 'desc')
      .limit(50)
      .get()

    const userPosts = (postsRes.data || []).map(normalizePost)
    const columns = splitWaterfall(userPosts)

    return {
      userPosts,
      leftPosts: columns.left,
      rightPosts: columns.right
    }
  },

  async fetchWalletBalance(openid) {
    if (!openid) return null

    const res = await db.collection('shopping_wallets')
      .where({ _openid: openid })
      .field({ balance: true })
      .limit(1)
      .get()

    if (!res.data || !res.data.length) return null
    return formatCurrencyFen(res.data[0].balance)
  },

  async loadUserCollections() {
    if (!this.data.isLoggedIn || this.data.collectionsLoading || this.data.collectionsLoaded) {
      return
    }

    this.setData({ collectionsLoading: true }, () => {
      this.refreshViewModel()
    })

    try {
      const openid = app.globalData.openid || this.data.userInfo._openid || ''
      const collectionsRes = await db.collection('community_collections')
        .where({ _openid: openid })
        .orderBy('create_time', 'desc')
        .limit(100)
        .get()

      const collections = collectionsRes.data || []
      if (!collections.length) {
        this.setData({
          collectedPosts: [],
          leftCollectedPosts: [],
          rightCollectedPosts: [],
          collectionsLoading: false,
          collectionsLoaded: true
        }, () => {
          this.refreshViewModel()
        })
        return
      }

      const postIds = collections.map((item) => item.post_id)
      const postsRes = await db.collection('community_posts')
        .where({ _id: _.in(postIds) })
        .get()

      const myOpenid = openid
      const postsMap = {}
      ;(postsRes.data || []).forEach((post) => {
        postsMap[post._id] = normalizePost(post)
      })

      const collectedPosts = postIds
        .map((id) => postsMap[id])
        .filter((post) => {
          if (!post) return false
          if (post.status === 1 && post._openid !== myOpenid) return false
          return true
        })

      const columns = splitWaterfall(collectedPosts)

      this.setData({
        collectedPosts,
        leftCollectedPosts: columns.left,
        rightCollectedPosts: columns.right,
        collectionsLoading: false,
        collectionsLoaded: true
      }, () => {
        this.refreshViewModel()
      })
    } catch (err) {
      console.error('加载收藏失败:', err)
      this.setData({
        collectionsLoading: false,
        collectionsLoaded: false
      }, () => {
        this.refreshViewModel()
      })
      wx.showToast({
        title: '收藏加载失败',
        icon: 'none'
      })
    }
  },

  ensureLogin() {
    if (this.data.isLoggedIn) return true
    this.goToLogin()
    return false
  },

  handleActionTap(e) {
    const action = e.currentTarget.dataset.action
    if (action && typeof this[action] === 'function') {
      this[action](e)
    }
  },

  switchContentTab(e) {
    const key = e.currentTarget.dataset.key
    if (!key || key === this.data.activeTabKey) return

    this.setData({ activeTabKey: key }, () => {
      this.refreshViewModel()
      if (key === 'collections' && this.data.isLoggedIn && !this.data.collectionsLoaded) {
        this.loadUserCollections()
      }
    })
  },

  goToLogin() {
    wx.navigateTo({
      url: '/pages/login/login'
    })
  },

  goToCommunity() {
    wx.switchTab({
      url: '/pages/community/index'
    })
  },

  goToMall() {
    wx.switchTab({
      url: '/pages/mall/home'
    })
  },

  goToPost() {
    if (!this.ensureLogin()) return
    wx.navigateTo({
      url: '/pages/community/post'
    })
  },

  goToFollowing() {
    if (!this.ensureLogin()) return
    wx.navigateTo({
      url: '/pages/user/relations?tab=0'
    })
  },

  goToFollowers() {
    if (!this.ensureLogin()) return
    wx.navigateTo({
      url: '/pages/user/relations?tab=1'
    })
  },

  onOrderEntryTap(e) {
    if (!this.ensureLogin()) return
    const status = e.currentTarget.dataset.status
    const url = status ? `/pages/order/list?status=${status}` : '/pages/order/list'
    wx.navigateTo({ url })
  },

  goToAllOrders() {
    if (!this.ensureLogin()) return
    wx.navigateTo({
      url: '/pages/order/list'
    })
  },

  goToAddress() {
    if (!this.ensureLogin()) return
    wx.navigateTo({
      url: '/pages/address/list'
    })
  },

  goToWallet() {
    if (!this.ensureLogin()) return
    wx.navigateTo({
      url: '/pages/wallet/index'
    })
  },

  goToMyWorkshop() {
    const { userInfo } = this.data
    if (!this.ensureLogin()) return
    if (!userInfo.is_certified || !userInfo.workshop_id) {
      wx.showToast({ title: '工坊信息异常', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/pages/workshop/index?id=${userInfo.workshop_id}`
    })
  },

  goToProductManage() {
    const { userInfo } = this.data
    if (!this.ensureLogin()) return
    if (!userInfo.is_certified || !userInfo.workshop_id) {
      wx.showToast({ title: '工坊信息异常', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/pages/product/manage?id=${userInfo.workshop_id}`
    })
  },

  goToPublish() {
    if (!this.ensureLogin()) return
    if (!this.data.userInfo.is_certified) {
      this.goToCertify()
      return
    }
    wx.navigateTo({
      url: '/pages/product/publish'
    })
  },

  goToSellerOrders() {
    if (!this.ensureLogin()) return
    if (!this.data.userInfo.is_certified) {
      this.goToCertify()
      return
    }
    wx.navigateTo({
      url: '/pages/order/seller-list'
    })
  },

  goToAftersaleCenter() {
    if (!this.ensureLogin()) return
    if (!this.data.userInfo.is_certified) {
      this.goToCertify()
      return
    }
    wx.navigateTo({
      url: '/pages/aftersale/seller-list'
    })
  },

  goToCertify() {
    if (!this.ensureLogin()) return

    if (this.data.userInfo.is_certified) {
      if (this.data.userInfo.workshop_id) {
        wx.navigateTo({
          url: `/pages/workshop/index?id=${this.data.userInfo.workshop_id}`
        })
      } else {
        wx.showToast({
          title: '工坊信息异常',
          icon: 'none'
        })
      }
      return
    }

    wx.navigateTo({
      url: '/pages/certification/apply'
    })
  },

  goToFootprint() {
    if (!this.ensureLogin()) return
    wx.showToast({
      title: '足迹功能开发中',
      icon: 'none'
    })
  },

  contactService() {
    wx.showToast({
      title: '客服功能开发中',
      icon: 'none'
    })
  },

  async onChangeHeroCover() {
    if (!this.ensureLogin()) return
    if (this.data.uploadingHeroCover) return

    try {
      const actionRes = await new Promise((resolve, reject) => {
        wx.showActionSheet({
          itemList: ['更换封面', '恢复默认封面'],
          success: resolve,
          fail: reject
        })
      })

      if (actionRes.tapIndex === 1) {
        await this.updateProfileBackground('')
        return
      }

      const mediaRes = await new Promise((resolve, reject) => {
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType: ['album', 'camera'],
          sizeType: ['compressed'],
          success: resolve,
          fail: reject
        })
      })

      const file = mediaRes.tempFiles && mediaRes.tempFiles[0]
      if (!file || !file.tempFilePath) return

      const openid = app.globalData.openid || this.data.userInfo._openid || ''
      if (!openid) {
        throw new Error('missing openid')
      }

      this.setData({ uploadingHeroCover: true })
      wx.showLoading({ title: '上传封面中...', mask: true })

      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `profile-backgrounds/${openid}_${Date.now()}.jpg`,
        filePath: file.tempFilePath
      })

      await this.updateProfileBackground(uploadRes.fileID, {
        successText: '封面已更新',
        keepLoading: true
      })
    } catch (err) {
      const isCancel = err && (
        err.errMsg === 'showActionSheet:fail cancel' ||
        err.errMsg === 'chooseMedia:fail cancel'
      )
      if (!isCancel) {
        console.error('更新个人封面失败:', err)
        wx.hideLoading()
        this.setData({ uploadingHeroCover: false })
        wx.showToast({
          title: '封面更新失败',
          icon: 'none'
        })
      }
    }
  },

  async updateProfileBackground(fileId, options = {}) {
    const userInfo = this.data.userInfo || {}
    const userId = userInfo._id
    if (!userId) {
      throw new Error('missing user id')
    }

    const previousFileId = userInfo.profile_bg_url || ''
    const successText = options.successText || (fileId ? '封面已更新' : '已恢复默认封面')

    try {
      if (!options.keepLoading) {
        this.setData({ uploadingHeroCover: true })
        wx.showLoading({ title: '保存中...', mask: true })
      }

      await db.collection('users').doc(userId).update({
        data: {
          profile_bg_url: fileId,
          update_time: new Date()
        }
      })

      const nextUserInfo = {
        ...userInfo,
        profile_bg_url: fileId,
        update_time: new Date()
      }
      app.globalData.userInfo = {
        ...(app.globalData.userInfo || {}),
        profile_bg_url: fileId,
        update_time: nextUserInfo.update_time
      }

      this.setData({
        userInfo: nextUserInfo,
        uploadingHeroCover: false
      }, () => {
        this.refreshViewModel()
      })

      wx.hideLoading()
      wx.showToast({
        title: successText,
        icon: 'success'
      })

      if (
        previousFileId &&
        previousFileId !== fileId &&
        typeof previousFileId === 'string' &&
        previousFileId.startsWith('cloud://')
      ) {
        wx.cloud.deleteFile({
          fileList: [previousFileId]
        }).catch((deleteErr) => {
          console.warn('旧封面清理失败:', deleteErr)
        })
      }
    } catch (err) {
      this.setData({ uploadingHeroCover: false })
      wx.hideLoading()
      throw err
    }
  },

  goToPostDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/pages/community/detail?id=${id}`
    })
  },

  onLogout() {
    if (!this.data.isLoggedIn) return

    wx.showModal({
      title: '退出登录',
      content: '确认退出当前账号吗？',
      confirmColor: '#d84f45',
      success: (res) => {
        if (!res.confirm) return

        app.logout()
        this._userKey = ''
        this.setData({
          isLoggedIn: false,
          userInfo: createDefaultUserInfo(),
          walletBalance: null,
          orderCounts: {
            pending: 0,
            toShip: 0,
            toReceive: 0,
            completed: 0,
            refund: 0
          },
          workshopData: null,
          workshopPendingOrders: 0,
          userPosts: [],
          leftPosts: [],
          rightPosts: [],
          collectedPosts: [],
          leftCollectedPosts: [],
          rightCollectedPosts: [],
          collectionsLoading: false,
          collectionsLoaded: false,
          activeTabKey: 'posts'
        }, () => {
          this.refreshViewModel()
        })
      }
    })
  },

  onPullDownRefresh() {
    this.refreshPageData({ silent: true }).finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  onShareAppMessage() {
    return {
      title: this.data.isLoggedIn
        ? `${this.data.displayName} 的个人中心 - 湘韵遗珍`
        : '湘韵遗珍 · 个人中心',
      path: '/pages/gerenzhongxin/gerenzhongxin',
      imageUrl: this.data.headerBackdrop || ''
    }
  }
})
