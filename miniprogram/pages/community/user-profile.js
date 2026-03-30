const app = getApp()
const db = wx.cloud.database()
const _ = db.command

const { normalizeUserProfile } = require('../../common/user-profile')

const DEFAULT_AVATAR = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'
const MAX_POST_LIMIT = 50
const MAX_FAVORITE_LIMIT = 100

function formatCount(num) {
  const value = Number(num) || 0
  if (value >= 10000) {
    return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}w`
  }
  if (value >= 1000) {
    return `${Math.round(value / 1000)}k`
  }
  return String(value)
}

function getCurrentOpenid() {
  return app.globalData.openid || (app.globalData.userInfo && app.globalData.userInfo._openid) || ''
}

function normalizeImages(images) {
  return (images || [])
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') return item.url || item.file_id || ''
      return ''
    })
    .filter(Boolean)
}

function splitWaterfall(items = []) {
  const left = []
  const right = []
  items.forEach((item, index) => {
    if (index % 2 === 0) {
      left.push(item)
    } else {
      right.push(item)
    }
  })
  return { left, right }
}

function formatRelativeTime(date) {
  if (!date) return '刚刚'
  const target = new Date(date)
  if (Number.isNaN(target.getTime())) return '刚刚'
  const now = new Date()
  const diff = now.getTime() - target.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`

  const month = String(target.getMonth() + 1).padStart(2, '0')
  const day = String(target.getDate()).padStart(2, '0')
  return `${month}-${day}`
}

function buildExcerpt(content) {
  const safeText = String(content || '').replace(/\s+/g, ' ').trim()
  if (!safeText) return ''
  if (safeText.length <= 42) return safeText
  return `${safeText.slice(0, 42)}...`
}

function buildRoleText(user = {}) {
  if (user.is_certified) {
    return user.certified_title || (user.ich_category ? `${user.ich_category}非遗传承人` : '认证非遗传承人')
  }
  return user.bio ? '在湘韵遗珍记录热爱与灵感' : '非遗同好 · 分享见闻与收藏'
}

function buildHeroBio(user = {}) {
  if (user.bio) return user.bio
  if (user.is_certified) {
    return '在湘韵遗珍分享手作日常、非遗见闻与匠心故事。'
  }
  return '在湘韵遗珍分享非遗灵感、旅途见闻与喜欢的好内容。'
}

function buildCardItem(post = {}, sourceKey = 'notes') {
  const images = normalizeImages(post.images)
  const authorInfo = post.author_info || {}
  return {
    ...post,
    sourceKey,
    images,
    imageCount: images.length,
    coverImage: images[0] || '',
    projectTag: post.related_projects && post.related_projects[0] ? post.related_projects[0].name : '',
    title: post.title || '未命名笔记',
    excerpt: buildExcerpt(post.content),
    likesText: formatCount(post.likes || 0),
    timeText: formatRelativeTime(post.create_time),
    isPrivate: Number(post.status) === 1,
    authorName: authorInfo.nickname || '匿名用户',
    authorAvatar: authorInfo.avatar_file_id || authorInfo.avatar_url || authorInfo.avatar || DEFAULT_AVATAR
  }
}

Page({
  data: {
    pageLoading: true,
    pageError: false,
    errorText: '',
    statusBarHeight: 20,
    navSolid: false,

    userId: '',
    userOpenid: '',
    userInfo: normalizeUserProfile({
      avatar_url: DEFAULT_AVATAR
    }),
    roleText: '',
    bioText: '',
    profileIdText: '',
    coverImage: DEFAULT_AVATAR,
    coverIsFallback: true,
    workshopInfo: null,

    followingText: '0',
    followersText: '0',
    appreciationText: '0',

    isSelf: false,
    isFollowing: false,
    isMutual: false,

    collectionsVisible: true,
    likesVisible: true,
    showWorkshopEntry: false,

    posts: [],
    leftPosts: [],
    rightPosts: [],
    postsLoading: false,
    noMorePosts: false,

    collections: [],
    leftCollections: [],
    rightCollections: [],
    collectionsLoading: false,
    collectionsLoaded: false,

    likedPosts: [],
    leftLikedPosts: [],
    rightLikedPosts: [],
    likedPostsLoading: false,
    likedPostsLoaded: false,

    activeLeftItems: [],
    activeRightItems: [],
    activeLoading: false,
    activeSectionTitle: '',
    activeSectionDesc: '',
    activeCountText: '0',
    activeEmptyTitle: '',
    activeEmptyDesc: '',
    activeActionText: '',
    activeShowAction: false,
    activeHasContent: false
  },

  onLoad(options) {
    const systemInfo = wx.getSystemInfoSync()
    const userId = options.userId || options.id || ''

    if (!userId) {
      this.setData({
        pageLoading: false,
        pageError: true,
        errorText: '用户不存在或参数缺失'
      })
      return
    }

    this.setData({
      statusBarHeight: systemInfo.statusBarHeight || 20,
      userId
    })

    this.initPage()
  },

  async initPage() {
    try {
      await this.loadUserInfo()
      this.checkIsSelf()
      await Promise.all([
        this.data.isSelf ? Promise.resolve() : this.checkFollowStatus(),
        this.loadUserPosts(),
        this.loadWorkshopInfo()
      ])
      this.syncActivePanel()
      this.setData({
        pageLoading: false,
        pageError: false,
        errorText: ''
      })
    } catch (err) {
      console.error('[community/user-profile] init failed:', err)
      this.setData({
        pageLoading: false,
        pageError: true,
        errorText: '主页加载失败，请稍后再试'
      })
    }
  },

  async loadUserInfo() {
    const { userId } = this.data

    let userRes = null
    try {
      userRes = await db.collection('users').doc(userId).get()
    } catch (err) {
      userRes = null
    }

    if (!userRes || !userRes.data) {
      const queryRes = await db.collection('users')
        .where({ _openid: userId })
        .limit(1)
        .get()
      if (queryRes.data && queryRes.data.length) {
        userRes = { data: queryRes.data[0] }
      }
    }

    if (!userRes || !userRes.data) {
      throw new Error('user not found')
    }

    const normalized = normalizeUserProfile(userRes.data)
    const avatarUrl = normalized.avatar_url || normalized.avatar_file_id || normalized.avatar || DEFAULT_AVATAR
    const appreciationValue = (normalized.stats && normalized.stats.likes) || 0
    const collectionValue = Number((userRes.data.stats && userRes.data.stats.collections) || 0)

    this.setData({
      userOpenid: userRes.data._openid || '',
      userInfo: {
        ...normalized,
        _id: userRes.data._id,
        _openid: userRes.data._openid,
        avatar_url: avatarUrl
      },
      roleText: buildRoleText(userRes.data),
      bioText: buildHeroBio(userRes.data),
      profileIdText: (userRes.data._id || userRes.data._openid || userId || '').slice(-10),
      coverImage: normalized.profile_bg_url || avatarUrl || DEFAULT_AVATAR,
      coverIsFallback: !normalized.profile_bg_url,
      collectionsVisible: userRes.data.collections_public !== false,
      likesVisible: userRes.data.likes_public !== false,
      showWorkshopEntry: Boolean(normalized.workshop_id)
    })

    this.refreshHeroStats(appreciationValue + collectionValue)
  },

  refreshHeroStats(appreciationTotal) {
    const stats = (this.data.userInfo && this.data.userInfo.stats) || {}
    this.setData({
      followingText: formatCount(stats.following || 0),
      followersText: formatCount(stats.followers || 0),
      appreciationText: formatCount(appreciationTotal)
    })
  },

  checkIsSelf() {
    const currentOpenid = getCurrentOpenid()
    const { userOpenid, userId } = this.data
    const isSelf = Boolean(currentOpenid) && (currentOpenid === userOpenid || currentOpenid === userId)
    this.setData({ isSelf })
  },

  async loadWorkshopInfo() {
    const workshopId = this.data.userInfo && this.data.userInfo.workshop_id
    if (!workshopId) return
    try {
      const res = await db.collection('shopping_workshops').doc(workshopId).get()
      this.setData({
        workshopInfo: res.data || null
      })
    } catch (err) {
      console.warn('[community/user-profile] load workshop failed:', err)
      this.setData({ workshopInfo: null })
    }
  },

  async checkFollowStatus() {
    const currentOpenid = getCurrentOpenid()
    const { userOpenid } = this.data

    if (!currentOpenid || !userOpenid || currentOpenid === userOpenid) return

    try {
      const [followRes, mutualRes] = await Promise.all([
        db.collection('community_follows')
          .where({
            follower_id: currentOpenid,
            target_id: userOpenid
          })
          .limit(1)
          .get(),
        db.collection('community_follows')
          .where({
            follower_id: userOpenid,
            target_id: currentOpenid
          })
          .limit(1)
          .get()
      ])

      const isFollowing = !!(followRes.data && followRes.data.length)
      const isMutual = isFollowing && !!(mutualRes.data && mutualRes.data.length)
      this.setData({ isFollowing, isMutual })
    } catch (err) {
      console.warn('[community/user-profile] check follow failed:', err)
    }
  },

  async loadUserPosts() {
    const { userOpenid, isSelf } = this.data
    if (!userOpenid) return

    this.setData({ postsLoading: true })
    try {
      const query = { _openid: userOpenid }
      if (!isSelf) {
        query.status = _.neq(1)
      }

      const res = await db.collection('community_posts')
        .where(query)
        .orderBy('create_time', 'desc')
        .limit(MAX_POST_LIMIT)
        .get()

      const posts = (res.data || []).map((item) => buildCardItem(item, 'notes'))
      const { left, right } = splitWaterfall(posts)

      this.setData({
        posts,
        leftPosts: left,
        rightPosts: right,
        postsLoading: false,
        noMorePosts: posts.length < MAX_POST_LIMIT
      })
    } catch (err) {
      console.error('[community/user-profile] load posts failed:', err)
      this.setData({ postsLoading: false })
    }
  },

  async loadUserCollections() {
    const { userOpenid, isSelf, collectionsVisible, collectionsLoaded } = this.data

    if (!userOpenid || collectionsLoaded || (!isSelf && !collectionsVisible)) return

    this.setData({ collectionsLoading: true })
    try {
      const res = await db.collection('community_collections')
        .where({ _openid: userOpenid })
        .orderBy('create_time', 'desc')
        .limit(MAX_FAVORITE_LIMIT)
        .get()

      const records = res.data || []
      if (!records.length) {
        this.setData({
          collections: [],
          leftCollections: [],
          rightCollections: [],
          collectionsLoading: false,
          collectionsLoaded: true
        })
        return
      }

      const postIds = records.map((item) => item.post_id).filter(Boolean)
      const postRes = await db.collection('community_posts')
        .where({
          _id: _.in(postIds),
          status: _.neq(1)
        })
        .get()

      const postMap = {}
      ;(postRes.data || []).forEach((item) => {
        postMap[item._id] = buildCardItem(item, 'collections')
      })

      const collections = postIds
        .map((id) => postMap[id])
        .filter(Boolean)

      const { left, right } = splitWaterfall(collections)

      this.setData({
        collections,
        leftCollections: left,
        rightCollections: right,
        collectionsLoading: false,
        collectionsLoaded: true
      })
    } catch (err) {
      console.error('[community/user-profile] load collections failed:', err)
      this.setData({ collectionsLoading: false })
    }
  },

  async loadUserLikedPosts() {
    const { userOpenid, isSelf, likesVisible, likedPostsLoaded } = this.data

    if (!userOpenid || likedPostsLoaded || (!isSelf && !likesVisible)) return

    this.setData({ likedPostsLoading: true })
    try {
      const res = await db.collection('community_post_likes')
        .where({ _openid: userOpenid })
        .orderBy('create_time', 'desc')
        .limit(MAX_FAVORITE_LIMIT)
        .get()

      const records = res.data || []
      if (!records.length) {
        this.setData({
          likedPosts: [],
          leftLikedPosts: [],
          rightLikedPosts: [],
          likedPostsLoading: false,
          likedPostsLoaded: true
        })
        return
      }

      const postIds = records.map((item) => item.target_id).filter(Boolean)
      const postRes = await db.collection('community_posts')
        .where({
          _id: _.in(postIds),
          status: _.neq(1)
        })
        .get()

      const postMap = {}
      ;(postRes.data || []).forEach((item) => {
        postMap[item._id] = buildCardItem(item, 'likes')
      })

      const likedPosts = postIds
        .map((id) => postMap[id])
        .filter(Boolean)

      const { left, right } = splitWaterfall(likedPosts)

      this.setData({
        likedPosts,
        leftLikedPosts: left,
        rightLikedPosts: right,
        likedPostsLoading: false,
        likedPostsLoaded: true
      })
    } catch (err) {
      console.error('[community/user-profile] load liked posts failed:', err)
      this.setData({ likedPostsLoading: false })
    }
  },

  syncActivePanel() {
    const { isSelf } = this.data
    const leftItems = this.data.leftPosts
    const rightItems = this.data.rightPosts
    const activeLoading = this.data.postsLoading
    const activeSectionTitle = '笔记'
    const activeSectionDesc = ''
    const activeCountText = String(leftItems.length + rightItems.length)
    const activeEmptyTitle = isSelf ? '还没有发布笔记' : 'Ta 还在闭关创作中...'
    const activeEmptyDesc = isSelf ? '去写下第一篇内容，个人主页就会慢慢热闹起来。' : '等下一次分享时，再来看看他的非遗灵感。'
    const activeActionText = '去发第一篇'
    const activeShowAction = isSelf

    this.setData({
      activeLeftItems: leftItems,
      activeRightItems: rightItems,
      activeLoading,
      activeSectionTitle,
      activeSectionDesc,
      activeCountText,
      activeEmptyTitle,
      activeEmptyDesc,
      activeActionText,
      activeShowAction,
      activeHasContent: Boolean(leftItems.length || rightItems.length)
    })
  },

  onPageScroll(e) {
    const scrollTop = e.scrollTop
    const navSolid = scrollTop > 220
    if (navSolid !== this.data.navSolid) {
      this.setData({ navSolid })
    }
  },

  async toggleFollow() {
    const currentOpenid = getCurrentOpenid()
    const { userOpenid, isFollowing } = this.data

    if (!currentOpenid) {
      wx.navigateTo({
        url: '/pages/login/login'
      })
      return
    }

    if (!userOpenid || currentOpenid === userOpenid) return

    try {
      if (isFollowing) {
        await this.unfollowUser()
      } else {
        await this.followUser()
      }
    } catch (err) {
      console.error('[community/user-profile] toggle follow failed:', err)
      wx.showToast({
        title: '操作失败',
        icon: 'none'
      })
    }
  },

  async followUser() {
    const currentOpenid = getCurrentOpenid()
    const { userOpenid } = this.data

    await db.collection('community_follows').add({
      data: {
        follower_id: currentOpenid,
        target_id: userOpenid,
        create_time: db.serverDate()
      }
    })

    await Promise.all([
      db.collection('users')
        .where({ _openid: userOpenid })
        .update({
          data: {
            'stats.followers': _.inc(1)
          }
        }),
      db.collection('users')
        .where({ _openid: currentOpenid })
        .update({
          data: {
            'stats.following': _.inc(1)
          }
        })
    ])

    const mutualRes = await db.collection('community_follows')
      .where({
        follower_id: userOpenid,
        target_id: currentOpenid
      })
      .limit(1)
      .get()

    const nextFollowers = Number((this.data.userInfo.stats && this.data.userInfo.stats.followers) || 0) + 1
    const isMutual = !!(mutualRes.data && mutualRes.data.length)
    this.setData({
      isFollowing: true,
      isMutual,
      'userInfo.stats.followers': nextFollowers,
      followersText: formatCount(nextFollowers)
    })

    if (app.globalData.userInfo && app.globalData.userInfo.stats) {
      app.globalData.userInfo.stats.following = (app.globalData.userInfo.stats.following || 0) + 1
    }

    wx.showToast({
      title: isMutual ? '已互相关注' : '关注成功',
      icon: 'success'
    })
  },

  async unfollowUser() {
    const currentOpenid = getCurrentOpenid()
    const { userOpenid } = this.data

    await db.collection('community_follows')
      .where({
        follower_id: currentOpenid,
        target_id: userOpenid
      })
      .remove()

    await Promise.all([
      db.collection('users')
        .where({ _openid: userOpenid })
        .update({
          data: {
            'stats.followers': _.inc(-1)
          }
        }),
      db.collection('users')
        .where({ _openid: currentOpenid })
        .update({
          data: {
            'stats.following': _.inc(-1)
          }
        })
    ])

    const nextFollowers = Math.max(0, Number((this.data.userInfo.stats && this.data.userInfo.stats.followers) || 0) - 1)
    this.setData({
      isFollowing: false,
      isMutual: false,
      'userInfo.stats.followers': nextFollowers,
      followersText: formatCount(nextFollowers)
    })

    if (app.globalData.userInfo && app.globalData.userInfo.stats) {
      app.globalData.userInfo.stats.following = Math.max(0, (app.globalData.userInfo.stats.following || 0) - 1)
    }

    wx.showToast({
      title: '已取消关注',
      icon: 'success'
    })
  },

  goToChat() {
    const currentOpenid = getCurrentOpenid()
    const { userOpenid } = this.data

    if (!currentOpenid) {
      wx.navigateTo({
        url: '/pages/login/login'
      })
      return
    }

    if (!userOpenid || userOpenid === currentOpenid) return

    wx.navigateTo({
      url: `/pages/chat/room?targetUserId=${userOpenid}`
    })
  },

  goToWorkshop() {
    const workshopId = this.data.userInfo && this.data.userInfo.workshop_id
    if (!workshopId) {
      wx.showToast({
        title: 'Ta 还没有开设工坊',
        icon: 'none'
      })
      return
    }

    wx.navigateTo({
      url: `/pages/workshop/index?id=${workshopId}`
    })
  },

  goToPostDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/pages/community/detail?id=${id}`
    })
  },

  goToFollowing() {
    const { userOpenid, isSelf } = this.data
    wx.navigateTo({
      url: `/pages/user/relations?tab=0&userId=${isSelf ? '' : userOpenid}`
    })
  },

  goToFollowers() {
    const { userOpenid, isSelf } = this.data
    wx.navigateTo({
      url: `/pages/user/relations?tab=1&userId=${isSelf ? '' : userOpenid}`
    })
  },

  goToPost() {
    wx.navigateTo({
      url: '/pages/community/post'
    })
  },

  goToEditProfile() {
    wx.navigateTo({
      url: '/pages/profile/edit',
      events: {
        profileUpdated: (nextUserInfo) => {
          const normalized = normalizeUserProfile(nextUserInfo || {})
          const avatarUrl = normalized.avatar_url || normalized.avatar_file_id || normalized.avatar || DEFAULT_AVATAR
          const appreciationValue = Number((normalized.stats && normalized.stats.likes) || 0)
          const collectionValue = Number((nextUserInfo && nextUserInfo.stats && nextUserInfo.stats.collections) || 0)
          this.setData({
            userInfo: {
              ...this.data.userInfo,
              ...normalized,
              avatar_url: avatarUrl
            },
            roleText: buildRoleText(nextUserInfo || {}),
            bioText: buildHeroBio(nextUserInfo || {}),
            coverImage: normalized.profile_bg_url || avatarUrl || DEFAULT_AVATAR,
            coverIsFallback: !normalized.profile_bg_url,
            showWorkshopEntry: Boolean(normalized.workshop_id)
          })
          this.refreshHeroStats(appreciationValue + collectionValue)
        }
      }
    })
  },

  goBack() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({
          url: '/pages/home/home'
        })
      }
    })
  },

  onShow() {
    if (!this.data.pageLoading && !this.data.pageError && this.data.userOpenid) {
      if (this.data.isSelf) {
        this.loadUserPosts().then(() => this.syncActivePanel())
      } else {
        this.checkFollowStatus()
      }
    }
  },

  onPullDownRefresh() {
    this.initPage().finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  onShareAppMessage() {
    const { userInfo, userId, coverImage } = this.data
    return {
      title: `${userInfo.nickname || 'TA'} 的主页 - 湘韵遗珍`,
      path: `/pages/community/user-profile?userId=${userId}`,
      imageUrl: coverImage || userInfo.avatar_url || DEFAULT_AVATAR
    }
  }
})
