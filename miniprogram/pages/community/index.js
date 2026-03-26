// pages/community/index.js
const app = getApp()
const db = wx.cloud.database()

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
    loading: true,

    // 顶部 & 布局
    statusBarHeight: 20,
    headerBaseHeight: 0,
    drawerTop: 0,
    activeTab: 'discover',
    searchCollapsed: false,
    _lastScrollTop: 0,

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
    const drawerTop = statusBarHeight + tabRowPx

    // 自定义 TabBar 高度：100rpx + safe-area-inset-bottom
    const safeBottom = sys.screenHeight - (sys.safeArea ? sys.safeArea.bottom : sys.screenHeight)
    const tabBarPx = Math.round(100 * ratio) + safeBottom

    // 输入区纯内容高度（不再含 safe-area，因为抽屉已经停在 TabBar 上方）
    const inputAreaPx = Math.round(112 * ratio)

    // 抽屉可见高度 = 全屏 - 抽屉顶 - TabBar
    // 消息区高度 = 抽屉可见高度 - 输入区高度
    const chatAreaHeight = sys.screenHeight - drawerTop - tabBarPx - inputAreaPx

    this._chatLayoutBase = {
      screenHeight: sys.screenHeight,
      drawerTop,
      inputAreaPx,
      tabBarPx
    }

    this.setData({
      statusBarHeight,
      headerBaseHeight,
      drawerTop,
      drawerBottom: tabBarPx,
      chatAreaHeight
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
    if (this.data.aiDrawerOpen) {
      this._destroyChatSession()
    }
    this.setData({
      aiDrawerOpen: false,
      activeTab: 'discover',
      searchCollapsed: false,
      chatKeyboardHeight: 0
    })
    if (this._chatLayoutBase) {
      const { screenHeight, drawerTop, inputAreaPx, tabBarPx } = this._chatLayoutBase
      this.setData({
        drawerBottom: tabBarPx,
        chatAreaHeight: screenHeight - drawerTop - tabBarPx - inputAreaPx
      })
    }
  },

  onPageScroll(e) {
    const currentTop = e.scrollTop
    const lastTop = this._lastScrollTop || 0

    if (currentTop > lastTop + 10 && currentTop > 60) {
      if (!this.data.searchCollapsed) this.setData({ searchCollapsed: true })
    }
    if (currentTop < lastTop - 10 || currentTop < 30) {
      if (this.data.searchCollapsed) this.setData({ searchCollapsed: false })
    }

    this._lastScrollTop = currentTop
  },

  /* ===== Tab 切换 ===== */
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (this.data.aiDrawerOpen) {
      this._destroyChatSession()
      this.setData({ aiDrawerOpen: false, searchCollapsed: false, activeTab: tab })
      return
    }
    if (tab !== this.data.activeTab) {
      this.setData({ activeTab: tab })
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
      this.setData({ aiDrawerOpen: false, activeTab: 'discover', searchCollapsed: false })
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

  /* ===== 加载帖子 ===== */
  async loadPosts() {
    this.setData({ loading: true })
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
        const _ = db.command
        const likedRes = await db.collection('community_post_likes')
          .where({ target_id: _.in(postList.map(i => i._id)), _openid: myOpenid })
          .field({ target_id: true })
          .get()
        const likedIds = (likedRes.data || []).map(i => i.target_id)
        postList = postList.map(item => ({ ...item, isLiked: likedIds.includes(item._id) }))
      } else {
        postList = postList.map(item => ({ ...item, isLiked: false }))
      }

      const leftColumn = [], rightColumn = []
      postList.forEach((item, idx) => {
        if (idx % 2 === 0) leftColumn.push(item)
        else rightColumn.push(item)
      })

      this.setData({ postList, leftColumn, rightColumn, loading: false })
    } catch (err) {
      console.error('加载帖子失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id
    const isLiked = e.currentTarget.dataset.isliked
    wx.navigateTo({ url: `/pages/community/detail?id=${id}&isLiked=${isLiked}` })
  },

  updatePostLikeStatus(postId, isLiked, likesCount) {
    const postList = this.data.postList.map(item =>
      item._id === postId ? { ...item, isLiked, likes: likesCount } : item
    )
    const leftColumn = [], rightColumn = []
    postList.forEach((item, idx) => {
      if (idx % 2 === 0) leftColumn.push(item)
      else rightColumn.push(item)
    })
    this.setData({ postList, leftColumn, rightColumn })
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
  },

  onPullDownRefresh() {
    this.loadPosts().then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {},
  onShareAppMessage() {}
})
