// pages/search/index.js
const app = getApp()
const db = wx.cloud.database()
const _ = db.command

// Tab 配置
const TABS = [
  { key: 'all',       label: '综合' },
  { key: 'post',      label: '帖子' },
  { key: 'project',   label: '非遗' },
  { key: 'inheritor', label: '传承人' },
  { key: 'topic',     label: '话题' },
  { key: 'user',      label: '用户' }
]

// 安全正则转义
function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 时间戳提取
function toMs(t) {
  if (!t) return 0
  if (t instanceof Date) return t.getTime()
  if (typeof t === 'number') return t
  const d = new Date(t)
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

Page({
  data: {
    statusBarHeight: 20,
    keyword: '',           // 当前显示关键词
    inputting: false,      // 输入框是否激活
    activeTab: 0,          // 当前 Tab 下标
    tabs: TABS,
    inkStyle: 'transform:translateX(0%)',

    // 各栏结果
    allResults: { posts: [], projects: [], inheritors: [], topics: [], users: [] },
    postResults: [],
    projectResults: [],
    inheritorResults: [],
    topicResults: [],
    userResults: [],

    loading: false,
    hasSearched: false,
    autoFocus: false,
    // 防止切 tab 时老数据闪烁
    tabChanging: false,

    // ── 帖子筛选面板 ──
    postFilterOpen: false,   // 下拉面板是否展开
    postFilter: {
      sort:     'default',  // default | latest | most_liked | most_commented
      timeRange: 'all'      // all | day | week | half_year
    },
    // 筛选条件文案配置（渲染用）
    sortOptions: [
      { key: 'default',       label: '综合排序' },
      { key: 'latest',        label: '最新发布' },
      { key: 'most_liked',    label: '最多点赞' },
      { key: 'most_commented',label: '最多评论' }
    ],
    timeOptions: [
      { key: 'all',       label: '全部时间' },
      { key: 'day',       label: '24小时内' },
      { key: 'week',      label: '一周内' },
      { key: 'half_year', label: '半年内' }
    ]
  },

  // 页面生命周期
  onLoad(options) {
    const sys = wx.getSystemInfoSync()
    this.setData({ statusBarHeight: sys.statusBarHeight || 20 })

    if (options.keyword) {
      // 带关键词进入：直接搜索，不弹键盘
      const kw = decodeURIComponent(options.keyword)
      this.setData({ keyword: kw, autoFocus: false })
      this._runSearch(kw)
    } else {
      // 空搜索进入：自动聚焦方便输入
      this.setData({ autoFocus: true })
    }
  },

  // ─── 搜索栏交互 ───
  onFocus() {
    this.setData({ inputting: true })
  },

  onBlur() {
    this.setData({ inputting: false })
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  onChipTap(e) {
    const kw = e.currentTarget.dataset.kw
    if (!kw) return
    this.setData({ keyword: kw })
    this._runSearch(kw)
  },

  onClear() {
    this.setData({
      keyword: '',
      hasSearched: false,
      postResults: [], projectResults: [],
      inheritorResults: [], topicResults: [], userResults: [],
      allResults: { posts: [], projects: [], inheritors: [], topics: [], users: [] }
    })
  },

  onConfirm() {
    const kw = this.data.keyword.trim()
    if (kw) this._runSearch(kw)
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) })
  },

  // ─── Tab 切换 ───
  switchTab(e) {
    const i = Number(e.currentTarget.dataset.i)

    // 已在帖子 tab(1) 再次点击 → 切换筛选面板开关
    if (i === 1 && this.data.activeTab === 1) {
      this.setData({ postFilterOpen: !this.data.postFilterOpen })
      return
    }

    if (this.data.loading) return

    this.setData({
      activeTab: i,
      postFilterOpen: false,
      tabChanging: true,
      inkStyle: `transform:translateX(${i * 100}%)`
    })
    setTimeout(() => this.setData({ tabChanging: false }), 280)

    if (this.data.hasSearched) {
      this._fetchTab(i, this.data.keyword.trim())
    }
  },

  // ─── 帖子筛选面板交互 ───
  closePostFilter() {
    this.setData({ postFilterOpen: false })
  },

  setPostFilterSort(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.postFilter.sort) return
    this.setData({ 'postFilter.sort': key })
    this._applyPostFilter()
  },

  setPostFilterTime(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.postFilter.timeRange) return
    this.setData({ 'postFilter.timeRange': key })
    this._applyPostFilter()
  },

  resetPostFilter() {
    this.setData({
      postFilter: { sort: 'default', timeRange: 'all' },
      postFilterOpen: false
    })
    this._fetchTab(1, this.data.keyword.trim())
  },

  _applyPostFilter() {
    if (!this.data.hasSearched || !this.data.keyword.trim()) return
    this._fetchTab(1, this.data.keyword.trim())
  },

  // 点击 AI搜一搜
  goAiSearch() {
    const kw = this.data.keyword.trim()
    const url = `/pages/ai-chat/index?source_scene=community_feed&source_entity_id=global&auto_query=${encodeURIComponent(kw)}`
    wx.navigateTo({ url })
  },

  // ─── 核心搜索 ───
  async _runSearch(keyword) {
    if (!keyword) return
    const tab = this.data.activeTab
    this.setData({ loading: true, hasSearched: true })

    try {
      await this._fetchTab(tab, keyword)
    } finally {
      this.setData({ loading: false })
    }
  },

  async _fetchTab(tabIndex, keyword) {
    if (!keyword) return
    this.setData({ loading: true })
    const re = db.RegExp({ regexp: escRe(keyword), options: 'i' })
    const myOpenid = app.globalData.openid

    try {
      switch (tabIndex) {
        case 0: await this._searchAll(keyword, re, myOpenid); break
        case 1: await this._searchPosts(re, myOpenid); break
        case 2: await this._searchProjects(re); break
        case 3: await this._searchInheritors(re); break
        case 4: await this._searchTopics(re, myOpenid); break
        case 5: await this._searchUsers(re); break
      }
    } catch (err) {
      console.error('[search] fetchTab error', err)
      wx.showToast({ title: '搜索出错，请重试', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  // 综合：并行查所有，取 top 结果
  async _searchAll(keyword, re, myOpenid) {
    const [posts, projects, inheritors, topics, users] = await Promise.allSettled([
      this._queryPosts(re, myOpenid, 6),
      this._queryProjects(re, 4),
      this._queryInheritors(re, 4),
      this._queryTopics(keyword, myOpenid, 6),
      this._queryUsers(re, 4)
    ])

    this.setData({
      allResults: {
        posts: posts.status === 'fulfilled' ? posts.value : [],
        projects: projects.status === 'fulfilled' ? projects.value : [],
        inheritors: inheritors.status === 'fulfilled' ? inheritors.value : [],
        topics: topics.status === 'fulfilled' ? topics.value : [],
        users: users.status === 'fulfilled' ? users.value : []
      }
    })
  },

  async _searchPosts(re, myOpenid) {
    const { sort, timeRange } = this.data.postFilter
    const list = await this._queryPosts(re, myOpenid, 40, sort, timeRange)
    this.setData({ postResults: list })
  },

  async _searchProjects(re) {
    const list = await this._queryProjects(re, 30)
    this.setData({ projectResults: list })
  },

  async _searchInheritors(re) {
    const list = await this._queryInheritors(re, 30)
    this.setData({ inheritorResults: list })
  },

  async _searchTopics(re, myOpenid) {
    const list = await this._queryTopics(this.data.keyword.trim(), myOpenid, 40)
    this.setData({ topicResults: list })
  },

  async _searchUsers(re) {
    const list = await this._queryUsers(re, 30)
    this.setData({ userResults: list })
  },

  // ─── 底层查询 ───
  async _queryPosts(re, myOpenid, limit, sort = 'default', timeRange = 'all') {
    // 时间范围条件
    const timeQuery = {}
    if (timeRange !== 'all') {
      const now = Date.now()
      const msMap = { day: 86400000, week: 604800000, half_year: 15552000000 }
      timeQuery.create_time = _.gte(new Date(now - (msMap[timeRange] || 0)))
    }

    let list = []
    try {
      const res = await db.collection('community_posts')
        .where(_.and([_.or([{ title: re }, { content: re }]), timeQuery]))
        .orderBy('create_time', 'desc')
        .limit(limit)
        .get()
      list = res.data || []
    } catch {
      const [a, b] = await Promise.allSettled([
        db.collection('community_posts').where({ title: re, ...timeQuery }).limit(limit).get(),
        db.collection('community_posts').where({ content: re, ...timeQuery }).limit(limit).get()
      ])
      const map = new Map()
      for (const r of [a, b]) {
        if (r.status === 'fulfilled') r.value.data.forEach(p => map.set(p._id, p))
      }
      list = Array.from(map.values()).sort((a, b) => toMs(b) - toMs(a)).slice(0, limit)
    }

    list = list.filter(p => !p.status || p.status === 0 || (myOpenid && p._openid === myOpenid))
    list.forEach(p => {
      p.images = (p.images || []).map(img => (typeof img === 'string' ? img : (img.url || '')))
    })

    // 客户端排序（时间过滤后数据量不大，可接受）
    if (sort === 'latest') {
      list.sort((a, b) => toMs(b) - toMs(a))
    } else if (sort === 'most_liked') {
      list.sort((a, b) => (b.likes || 0) - (a.likes || 0))
    } else if (sort === 'most_commented') {
      list.sort((a, b) => (b.comment_count || 0) - (a.comment_count || 0))
    }
    // default: 保持服务端 create_time desc

    return list
  },

  async _queryProjects(re, limit) {
    const [a, b] = await Promise.allSettled([
      db.collection('ich_projects').where({ name: re }).limit(limit).get(),
      db.collection('ich_projects').where({ category: re }).limit(limit).get()
    ])
    const map = new Map()
    for (const r of [a, b]) {
      if (r.status === 'fulfilled') r.value.data.forEach(p => map.set(p._id, p))
    }
    return Array.from(map.values()).slice(0, limit)
  },

  async _queryInheritors(re, limit) {
    const [a, b] = await Promise.allSettled([
      db.collection('ich_inheritors').where({ name: re }).limit(limit).get(),
      db.collection('ich_inheritors').where({ craft: re }).limit(limit).get()
    ])
    const map = new Map()
    for (const r of [a, b]) {
      if (r.status === 'fulfilled') r.value.data.forEach(p => map.set(p._id, p))
    }
    return Array.from(map.values()).slice(0, limit)
  },

  async _queryTopics(keyword, myOpenid, limit) {
    // 查包含该关键词 tag 的帖子，聚合 tag 并统计帖子数
    const re = db.RegExp({ regexp: escRe(keyword), options: 'i' })
    let posts = []
    try {
      const res = await db.collection('community_posts')
        .where({ tags: re })
        .field({ tags: true, _id: true })
        .limit(100)
        .get()
      posts = res.data || []
    } catch (e) { /* ignore */ }

    // 计算每个 tag 的帖子数
    const countMap = new Map()
    posts.forEach(p => {
      (p.tags || []).forEach(tag => {
        if (typeof tag === 'string' && tag.toLowerCase().includes(keyword.toLowerCase())) {
          countMap.set(tag, (countMap.get(tag) || 0) + 1)
        }
      })
    })
    return Array.from(countMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tag, count]) => ({ tag, count }))
  },

  async _queryUsers(re, limit) {
    let list = []
    try {
      const res = await db.collection('users')
        .where(_.or([{ nickname: re }, { certified_title: re }]))
        .limit(limit)
        .get()
      list = res.data || []
    } catch {
      const [a, b] = await Promise.allSettled([
        db.collection('users').where({ nickname: re }).limit(limit).get(),
        db.collection('users').where({ certified_title: re }).limit(limit).get()
      ])
      const map = new Map()
      for (const r of [a, b]) {
        if (r.status === 'fulfilled') r.value.data.forEach(u => map.set(u._id, u))
      }
      list = Array.from(map.values()).slice(0, limit)
    }
    return list.map(u => ({
      _id: u._id,
      openid: u._openid,
      nickname: u.nickname || '用户',
      avatar_url: u.avatar_url || '/images/avatar.png',
      is_certified: !!u.is_certified,
      certified_title: u.certified_title || '',
      bio: u.bio || ''
    }))
  },

  // ─── 跳转 ───
  noop() {},

  goPost(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/community/detail?id=${id}` })
  },

  goProject(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/resource/project-detail?id=${id}` })
  },

  goInheritor(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/resource/inheritor-detail?id=${id}` })
  },

  goTopic(e) {
    const tag = e.currentTarget.dataset.tag
    if (tag) wx.navigateTo({ url: `/pages/community/topic?tag=${encodeURIComponent(tag)}` })
  },

  goUser(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/community/user-profile?userId=${id}` })
  }
})
