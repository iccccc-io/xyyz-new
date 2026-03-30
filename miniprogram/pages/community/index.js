// pages/community/index.js
const app = getApp()
const db = wx.cloud.database()
const _ = db.command

const CHAT_QUICK_REPLIES = ['推荐一项湖南非遗', '有什么周末体验攻略？', '哪些非遗最受欢迎？']
const CHAT_WELCOME =
  '你好呀～我是问一问小助手 🎋\n' +
  '我会综合社区里的游记、心得，和非遗资讯里的权威资料来作答，\n' +
  '帮你少翻页、一次听明白 📰✨\n' +
  '想聊湖南哪项非遗、周末去哪儿体验，\n' +
  '点下面一句话或直接输入都可以～'

Page({
  data: {
    // 搜索
    communitySearchKw: '',

    // 社区帖子
    postList: [],
    leftColumn: [],
    rightColumn: [],
    /** 发现流是否已完成至少一次拉取（用于空状态，不用底部转圈） */
    discoverFetched: false,

    // 关注：仅展示已关注用户的帖子
    followPostList: [],
    followLeftColumn: [],
    followRightColumn: [],
    /** 关注流是否已完成至少一次拉取（不显示列表内转圈） */
    followFetched: false,
    followEmptyDesc: '',

    // 顶部 & 布局
    statusBarHeight: 20,
    headerBaseHeight: 0,
    headerCollapsedHeight: 0,
    feedSwiperCollapsedPx: 500,
    drawerTop: 0,
    activeTab: 'discover',
    feedSwiperIndex: 0, // 0 发现 1 关注（与 swiper 联动）
    feedSwiperHeightPx: 500,
    searchCollapsed: false,
    _lastScrollTop: 0,

    /** scroll-view 下拉刷新：仅列表区域，不与顶栏联动 */
    refresherTriggered: false,

    // AI 抽屉
    aiDrawerOpen: false,
    chatMessages: [],
    chatInputValue: '',
    chatLoading: false,
    chatIsSending: false,
    chatConversationId: '',
    chatWelcomeText: CHAT_WELCOME,
    chatQuickReplies: CHAT_QUICK_REPLIES,
    chatScrollToView: '',
    chatAreaHeight: 400,
    drawerBottom: 0,
    chatKeyboardHeight: 0
  },

  onLoad() {
    const sys = wx.getSystemInfoSync()
    const statusBarHeight = sys.statusBarHeight || 20
    const ratio = sys.screenWidth / 750

    const tabRowPx = Math.round(96 * ratio)
    const searchRowPx = Math.round(88 * ratio)
    const headerBaseHeight = statusBarHeight + tabRowPx + searchRowPx
    const headerCollapsedHeight = statusBarHeight + tabRowPx
    const drawerTop = statusBarHeight + tabRowPx

    // 自定义 TabBar 高度：100rpx + safe-area-inset-bottom
    const safeBottom = sys.screenHeight - (sys.safeArea ? sys.safeArea.bottom : sys.screenHeight)
    const tabBarPx = Math.round(100 * ratio) + safeBottom

    // 输入区纯内容高度（不再含 safe-area，因为抽屉已经停在 TabBar 上方）
    const inputAreaPx = Math.round(112 * ratio)

    // 抽屉可见高度 = 全屏 - 抽屉顶 - TabBar
    // 消息区高度 = 抽屉可见高度 - 输入区高度
    const chatAreaHeight = sys.screenHeight - drawerTop - tabBarPx - inputAreaPx
    const feedSwiperHeightPx = Math.max(200, sys.screenHeight - headerBaseHeight - tabBarPx)
    const feedSwiperCollapsedPx = Math.max(200, sys.screenHeight - headerCollapsedHeight - tabBarPx)

    this._chatLayoutBase = {
      screenHeight: sys.screenHeight,
      drawerTop,
      inputAreaPx,
      tabBarPx,
      headerBaseHeight
    }

    this.setData({
      statusBarHeight,
      headerBaseHeight,
      headerCollapsedHeight,
      feedSwiperCollapsedPx,
      drawerTop,
      drawerBottom: tabBarPx,
      chatAreaHeight,
      feedSwiperHeightPx
    })

    this.loadPosts()

    // 键盘弹起时：键盘从屏幕底部升起，替代 TabBar 区域
    this._kbListener = (res) => {
      const kbH = res.height
      const { screenHeight, drawerTop: dt, inputAreaPx: iap, tabBarPx: tbp } = this._chatLayoutBase
      if (kbH > 0) {
        this.setData({
          chatKeyboardHeight: kbH,
          drawerBottom: kbH,
          chatAreaHeight: screenHeight - dt - kbH - iap
        })
        this._scrollChatToBottom()
      } else {
        this.setData({
          chatKeyboardHeight: 0,
          drawerBottom: tbp,
          chatAreaHeight: screenHeight - dt - tbp - iap
        })
      }
    }
    wx.onKeyboardHeightChange(this._kbListener)
  },

  onUnload() {
    if (this._kbListener) wx.offKeyboardHeightChange(this._kbListener)
  },

  onHide() {
    const hadAiDrawer = this.data.aiDrawerOpen
    if (hadAiDrawer) {
      this._destroyChatSession()
    }
    const layoutPatch = {
      aiDrawerOpen: false,
      searchCollapsed: false,
      chatKeyboardHeight: 0
    }
    // 仅从问一问离开时回到发现；关注/发现 tab 保持不变
    if (hadAiDrawer) {
      layoutPatch.activeTab = 'discover'
      layoutPatch.feedSwiperIndex = 0
    }
    this.setData(layoutPatch)
    if (this._chatLayoutBase) {
      const { screenHeight, drawerTop, inputAreaPx, tabBarPx } = this._chatLayoutBase
      this.setData({
        drawerBottom: tabBarPx,
        chatAreaHeight: screenHeight - drawerTop - tabBarPx - inputAreaPx
      })
    }
  },

  onPageScroll(e) {
    this._applySearchCollapseScroll(e.scrollTop)
  },

  /** 瀑布流在 swiper 内 scroll-view 滚动时调用 */
  onTabScroll(e) {
    this._applySearchCollapseScroll(e.detail.scrollTop)
  },

  onFeedRefresherRefresh() {
    if (this.data.aiDrawerOpen) return
    this.setData({ refresherTriggered: true })
    const p =
      this.data.feedSwiperIndex === 1 ? this.loadFollowPosts() : this.loadPosts()
    Promise.resolve(p)
      .catch(() => {})
      .finally(() => {
        this.setData({ refresherTriggered: false })
      })
  },

  _applySearchCollapseScroll(currentTop) {
    const lastTop = this._lastScrollTop || 0
    if (currentTop > lastTop + 10 && currentTop > 60) {
      if (!this.data.searchCollapsed) this.setData({ searchCollapsed: true })
    }
    if (currentTop < lastTop - 10 || currentTop < 30) {
      if (this.data.searchCollapsed) this.setData({ searchCollapsed: false })
    }
    this._lastScrollTop = currentTop
  },

  onFeedSwiperChange(e) {
    if (this.data.aiDrawerOpen) return
    if (this.data.refresherTriggered) {
      this.setData({ refresherTriggered: false })
    }
    const cur = e.detail.current
    if (cur === 0) {
      this.setData({ activeTab: 'discover', feedSwiperIndex: 0 })
      return
    }
    this.setData({ activeTab: 'follow', feedSwiperIndex: 1 })
    // 手势滑动：拉取关注流；刚点过 Tab 则在短时间内由 switchTab 已请求，避免重复
    const recentTabTap = Date.now() - (this._lastFeedNavAt || 0) < 450
    if (!recentTabTap) this.loadFollowPosts()
  },

  /* ===== Tab 切换 ===== */
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (this.data.refresherTriggered) {
      this.setData({ refresherTriggered: false })
    }
    if (this.data.aiDrawerOpen) {
      this._destroyChatSession()
      const idx = tab === 'follow' ? 1 : 0
      this._lastFeedNavAt = Date.now()
      this.setData({
        aiDrawerOpen: false,
        searchCollapsed: false,
        activeTab: tab,
        feedSwiperIndex: idx
      })
      if (tab === 'follow') this.loadFollowPosts()
      return
    }
    if (tab === 'discover' && this.data.activeTab !== 'discover') {
      this._lastFeedNavAt = Date.now()
      this.setData({ activeTab: 'discover', feedSwiperIndex: 0 })
      return
    }
    if (tab === 'follow' && this.data.activeTab !== 'follow') {
      this._lastFeedNavAt = Date.now()
      this.setData({ activeTab: 'follow', feedSwiperIndex: 1 })
      this.loadFollowPosts()
    }
  },

  /* ===== AI 抽屉 ===== */
  toggleAiDrawer() {
    const opening = !this.data.aiDrawerOpen
    if (opening) {
      this._startNewChatSession()
      this.setData({ aiDrawerOpen: true, activeTab: 'ai', searchCollapsed: true })
      setTimeout(() => this._scrollChatToBottom(), 350)
    } else {
      this._destroyChatSession()
      this.setData({
        aiDrawerOpen: false,
        activeTab: 'discover',
        feedSwiperIndex: 0,
        searchCollapsed: false
      })
    }
  },

  // 防止抽屉内的滑动穿透到底层页面
  catchTouchMove() {},

  /* ===== AI 对话初始化：每次打开生成新 conversationId ===== */
  _startNewChatSession() {
    const openid = app.globalData.openid
    if (!openid) return
    const conversationId = `${openid}_community_temp_${Date.now()}`
    this.setData({
      chatConversationId: conversationId,
      chatMessages: [],
      chatInputValue: '',
      chatLoading: false,
      chatIsSending: false,
      chatScrollToView: ''
    })
  },

  /* 销毁本次对话：调用云函数删除数据库记录 + 清空本地 */
  _destroyChatSession() {
    const cid = this.data.chatConversationId
    if (cid) {
      wx.cloud.callFunction({
        name: 'ai_chat_proxy',
        data: { action: 'clear', conversation_id: cid }
      }).catch(() => {})
    }
    this.setData({
      chatMessages: [],
      chatInputValue: '',
      chatLoading: false,
      chatIsSending: false,
      chatConversationId: '',
      chatScrollToView: ''
    })
  },


  _buildAiMsg(msg) {
    const content = msg.content || ''
    const citations = Array.isArray(msg.citations) ? msg.citations : []
    const segments = this._parseSegments(content, citations)
    return { ...msg, segments, citations, suggested_questions: msg.suggested_questions || [] }
  },

  _parseSegments(text, citations) {
    if (!text) return [{ type: 'text', text: '' }]
    const map = {}
    citations.forEach(c => { map[c.ref_id] = c })
    const segs = []
    const regex = /\[(\d+)\]/g
    let last = 0, m
    while ((m = regex.exec(text)) !== null) {
      if (m.index > last) segs.push({ type: 'text', text: text.slice(last, m.index) })
      const c = map[m[1]]
      if (c) segs.push({ type: 'ref', refId: m[1], title: c.title || '', targetType: c.type || '', targetId: c.target_id || '' })
      else segs.push({ type: 'text', text: m[0] })
      last = regex.lastIndex
    }
    if (last < text.length) segs.push({ type: 'text', text: text.slice(last) })
    return segs.length > 0 ? segs : [{ type: 'text', text }]
  },

  /* ===== 发送消息 ===== */
  onChatInput(e) {
    this.setData({ chatInputValue: e.detail.value })
  },

  async sendChatMessage() {
    const query = this.data.chatInputValue.trim()
    if (!query || this.data.chatIsSending) return

    this.setData({ chatIsSending: true, chatInputValue: '', chatLoading: true })

    const userMsg = {
      _id: `user_${Date.now()}`,
      role: 'user',
      type: 'text',
      content: query,
      create_time: new Date()
    }

    this.setData({ chatMessages: [...this.data.chatMessages, userMsg] })
    this._scrollChatToBottom()

    // 入库
    try {
      await db.collection('ai_chat_history').add({
        data: {
          conversation_id: this.data.chatConversationId,
          role: 'user', type: 'text', content: query,
          create_time: db.serverDate()
        }
      })
    } catch (e) { console.warn('用户消息入库失败:', e) }

    // 调用 AI
    try {
      const res = await wx.cloud.callFunction({
        name: 'ai_chat_proxy',
        data: {
          action: 'send',
          query,
          conversation_id: this.data.chatConversationId,
          inputs: {
            source_scene: 'community_feed',
            source_entity_name: '',
            source_entity_id: 'global'
          }
        }
      })

      const result = res.result
      if (result && result.success) {
        const raw = {
          _id: `ai_${Date.now()}`,
          role: 'assistant', type: 'text',
          content: result.answer || '',
          citations: result.citations || [],
          suggested_questions: result.suggested_questions || [],
          create_time: new Date()
        }
        this.setData({
          chatMessages: [...this.data.chatMessages, this._buildAiMsg(raw)],
          chatLoading: false,
          chatIsSending: false
        })
      } else {
        this._appendChatError(result ? result.message : '网络开小差了，请稍后再试。')
      }
    } catch (err) {
      console.error('AI 对话异常:', err)
      this._appendChatError('网络开小差了，请稍后再试。')
    }

    this._scrollChatToBottom()
  },

  _appendChatError(msg) {
    const errMsg = {
      _id: `err_${Date.now()}`,
      role: 'assistant', type: 'text',
      content: msg,
      isError: true,
      segments: [{ type: 'text', text: msg }],
      citations: [], suggested_questions: [],
      create_time: new Date()
    }
    this.setData({
      chatMessages: [...this.data.chatMessages, errMsg],
      chatLoading: false,
      chatIsSending: false
    })
  },

  onChatQuickReply(e) {
    this.setData({ chatInputValue: e.currentTarget.dataset.text })
    this.sendChatMessage()
  },

  onChatSuggestedTap(e) {
    this.setData({ chatInputValue: e.currentTarget.dataset.text })
    this.sendChatMessage()
  },

  onChatCitationTap(e) {
    const { type, id } = e.currentTarget.dataset
    const routes = {
      ich_project: '/pages/resource/project-detail?id=',
      ich_inheritor: '/pages/resource/inheritor-detail?id=',
      ich_news: '/pages/resource/news-detail?id=',
      community_post: '/pages/community/detail?id='
    }
    const route = routes[type]
    if (route && id) wx.navigateTo({ url: route + id })
  },

  _scrollChatToBottom() {
    const msgs = this.data.chatMessages
    if (msgs.length > 0) {
      this.setData({ chatScrollToView: `cmsg-${msgs.length - 1}` })
    } else {
      this.setData({ chatScrollToView: 'chat-scroll-end' })
    }
  },

  /* ===== 搜索 ===== */
  onCommunitySearchInput(e) {
    this.setData({ communitySearchKw: e.detail.value })
  },

  onCommunitySearchConfirm() {
    const kw = this.data.communitySearchKw.trim()
    const url = kw
      ? `/pages/search/index?keyword=${encodeURIComponent(kw)}`
      : '/pages/search/index'
    wx.navigateTo({ url })
  },

  goToSearch() {
    wx.navigateTo({ url: '/pages/search/index' })
  },

  _waterfallFromList(postList) {
    const leftColumn = []
    const rightColumn = []
    postList.forEach((item, idx) => {
      if (idx % 2 === 0) leftColumn.push(item)
      else rightColumn.push(item)
    })
    return { leftColumn, rightColumn }
  },

  /**
   * 关注 tab：拉取 community_follows 中 target_id，再查这些 openid 的帖子
   */
  async loadFollowPosts() {
    const myOpenid = app.globalData.openid
    if (!myOpenid) {
      this.setData({
        followPostList: [],
        followLeftColumn: [],
        followRightColumn: [],
        followFetched: true,
        followEmptyDesc: '登录后可查看关注动态'
      })
      return
    }

    try {
      const followRes = await db.collection('community_follows')
        .where({ follower_id: myOpenid })
        .field({ target_id: true })
        .get()

      const followedIds = [...new Set((followRes.data || []).map(r => r.target_id).filter(Boolean))]

      if (followedIds.length === 0) {
        this.setData({
          followPostList: [],
          followLeftColumn: [],
          followRightColumn: [],
          followFetched: true,
          followEmptyDesc: '还没有关注任何人，去发现页逛逛吧'
        })
        return
      }

      const chunkSize = 20
      const chunks = []
      for (let i = 0; i < followedIds.length; i += chunkSize) {
        chunks.push(followedIds.slice(i, i + chunkSize))
      }

      const queryChunk = async ids => {
        try {
          return await db
            .collection('community_posts')
            .where({ _openid: _.in(ids) })
            .orderBy('create_time', 'desc')
            .limit(40)
            .get()
        } catch (e) {
          const r = await db
            .collection('community_posts')
            .where({ _openid: _.in(ids) })
            .limit(40)
            .get()
          const list = (r.data || []).sort((a, b) => {
            const ta = a.create_time instanceof Date ? a.create_time.getTime() : new Date(a.create_time || 0).getTime()
            const tb = b.create_time instanceof Date ? b.create_time.getTime() : new Date(b.create_time || 0).getTime()
            return tb - ta
          })
          return { data: list }
        }
      }

      const results = await Promise.all(chunks.map(ids => queryChunk(ids)))
      const map = new Map()
      results.forEach(r => (r.data || []).forEach(p => map.set(p._id, p)))

      let postList = Array.from(map.values())
      postList.sort((a, b) => {
        const ta = a.create_time instanceof Date ? a.create_time.getTime() : new Date(a.create_time || 0).getTime()
        const tb = b.create_time instanceof Date ? b.create_time.getTime() : new Date(b.create_time || 0).getTime()
        return tb - ta
      })

      postList = postList
        .filter(post => {
          if (!post.status || post.status === 0) return true
          return post._openid === myOpenid
        })
        .slice(0, 50)

      postList.forEach(post => {
        post.images = (post.images || []).map(img => (typeof img === 'string' ? img : img.url || ''))
      })

      if (postList.length > 0) {
        const likedIdSet = new Set()
        const ids = postList.map(i => i._id)
        for (let i = 0; i < ids.length; i += chunkSize) {
          const batch = ids.slice(i, i + chunkSize)
          const likedRes = await db
            .collection('community_post_likes')
            .where({ target_id: _.in(batch), _openid: myOpenid })
            .field({ target_id: true })
            .get()
          ;(likedRes.data || []).forEach(row => likedIdSet.add(row.target_id))
        }
        postList = postList.map(item => ({ ...item, isLiked: likedIdSet.has(item._id) }))
      } else {
        postList = postList.map(item => ({ ...item, isLiked: false }))
      }

      const { leftColumn, rightColumn } = this._waterfallFromList(postList)

      this.setData({
        followPostList: postList,
        followLeftColumn: leftColumn,
        followRightColumn: rightColumn,
        followFetched: true,
        followEmptyDesc: postList.length === 0 ? '你关注的人还没发动态' : ''
      })
    } catch (err) {
      console.error('加载关注动态失败', err)
      this.setData({
        followFetched: true,
        followEmptyDesc: '加载失败，请下拉重试'
      })
    }
  },

  /* ===== 加载帖子 ===== */
  async loadPosts() {
    try {
      const res = await db.collection('community_posts')
        .orderBy('create_time', 'desc')
        .limit(100)
        .get()

      const myOpenid = app.globalData.openid

      let postList = res.data.filter(post => {
        if (!post.status || post.status === 0) return true
        return post._openid === myOpenid
      }).slice(0, 50)

      postList.forEach(post => {
        post.images = (post.images || []).map(img => typeof img === 'string' ? img : (img.url || ''))
      })

      if (myOpenid && postList.length > 0) {
        const likedRes = await db.collection('community_post_likes')
          .where({ target_id: _.in(postList.map(i => i._id)), _openid: myOpenid })
          .field({ target_id: true })
          .get()
        const likedIds = (likedRes.data || []).map(i => i.target_id)
        postList = postList.map(item => ({ ...item, isLiked: likedIds.includes(item._id) }))
      } else {
        postList = postList.map(item => ({ ...item, isLiked: false }))
      }

      const wf = this._waterfallFromList(postList)
      this.setData({
        postList,
        leftColumn: wf.leftColumn,
        rightColumn: wf.rightColumn,
        discoverFetched: true
      })
    } catch (err) {
      console.error('加载帖子失败:', err)
      this.setData({ discoverFetched: true })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id
    const isLiked = e.currentTarget.dataset.isliked
    wx.navigateTo({ url: `/pages/community/detail?id=${id}&isLiked=${isLiked}` })
  },

  updatePostLikeStatus(postId, isLiked, likesCount) {
    const mapOne = list =>
      list.map(item => (item._id === postId ? { ...item, isLiked, likes: likesCount } : item))
    const postList = mapOne(this.data.postList)
    const followPostList = mapOne(this.data.followPostList)
    const wf = this._waterfallFromList(postList)
    const fw = this._waterfallFromList(followPostList)
    this.setData({
      postList,
      leftColumn: wf.leftColumn,
      rightColumn: wf.rightColumn,
      followPostList,
      followLeftColumn: fw.leftColumn,
      followRightColumn: fw.rightColumn
    })
  },

  goToPost() {
    if (!app.requireLogin('/pages/community/post')) return
    wx.navigateTo({ url: '/pages/community/post' })
  },

  onReady() {},

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateActive(1)
    }
    app.refreshChatUnreadBadge(this).catch(() => {})
    if (this.data.activeTab === 'follow') {
      this.setData({ feedSwiperIndex: 1 })
      this.loadFollowPosts()
    }
  },

  onReachBottom() {},
  onShareAppMessage() {}
})
