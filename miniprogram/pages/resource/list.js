const db = wx.cloud.database()

Page({
  data: {
    statusBarHeight: 20,
    currentTab: 'project',
    newsCategory: '',
    dataList: [],
    searchKeyword: '',
    loading: false,
    noMore: false,
    pageSize: 20,
    showFilter: false,
    filterData: {
      city: '',
      category: '',
      level: '',
      batch: ''
    },
    headerHeight: 200,
    cityOptions: [
      '长沙市', '株洲市', '湘潭市', '衡阳市', '邵阳市', '岳阳市',
      '常德市', '张家界市', '益阳市', '郴州市', '永州市', '怀化市',
      '娄底市', '湘西土家族苗族自治州'
    ],
    categoryOptions: [
      '民间文学', '传统音乐', '传统舞蹈', '传统戏剧', '曲艺',
      '传统体育', '传统美术', '传统技艺', '传统医药', '民俗'
    ],
    levelOptions: ['国家级', '省级', '市级', '县级'],
    batchOptions: [
      '第一批', '第二批', '第三批', '第四批', '第五批',
      '第六批', '第七批', '第八批', '第九批', '第十批'
    ]
  },

  onLoad(options) {
    const sysInfo = wx.getSystemInfoSync()
    this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 })

    if (options.tab) {
      this.setData({ currentTab: options.tab })
    }
    // 支持从首页地图带城市参数跳转，自动预设城市筛选
    if (options.city) {
      this.setData({ filterData: { ...this.data.filterData, city: decodeURIComponent(options.city) } })
    }
    this.calculateHeaderHeight()
    this.loadData()
  },

  calculateHeaderHeight() {
    setTimeout(() => {
      const query = wx.createSelectorQuery()
      query.select('.fixed-header').boundingClientRect()
      query.exec((res) => {
        if (res[0]) {
          this.setData({ headerHeight: res[0].height })
        }
      })
    }, 150)
  },

  goBack() {
    wx.navigateBack({
      fail: () => { wx.switchTab({ url: '/pages/home/home' }) }
    })
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.currentTab) return
    this.setData({
      currentTab: tab,
      dataList: [],
      searchKeyword: '',
      newsCategory: '',
      noMore: false,
      filterData: { city: '', category: '', level: '', batch: '' }
    })
    this.calculateHeaderHeight()
    this.loadData()
  },

  switchNewsCategory(e) {
    const cat = e.currentTarget.dataset.category
    if (cat === this.data.newsCategory) return
    this.setData({ newsCategory: cat, dataList: [], noMore: false })
    this.loadData()
  },

  onSearchChange(e) {
    this.setData({ searchKeyword: e.detail })
  },

  onSearch() {
    this.setData({ dataList: [], noMore: false })
    this.loadData()
  },

  openFilter() {
    this.setData({ showFilter: true })
  },

  closeFilter() {
    this.setData({ showFilter: false })
  },

  selectFilter(e) {
    const { type, value } = e.currentTarget.dataset
    this.setData({ [`filterData.${type}`]: value })
  },

  resetFilter() {
    this.setData({
      filterData: { city: '', category: '', level: '', batch: '' }
    })
  },

  confirmFilter() {
    this.closeFilter()
    this.setData({ dataList: [], noMore: false })
    this.loadData()
  },

  async loadData(loadMore = false) {
    if (this.data.loading || (loadMore && this.data.noMore)) return
    this.setData({ loading: true })

    try {
      const { currentTab, searchKeyword, filterData, newsCategory, dataList, pageSize } = this.data
      let collectionName
      let query = {}

      if (currentTab === 'project') {
        collectionName = 'ich_projects'
        if (searchKeyword) {
          query.name = db.RegExp({ regexp: searchKeyword, options: 'i' })
        }
        if (filterData.city) query.city = filterData.city
        if (filterData.category) query.category = filterData.category
        if (filterData.level) query.level = filterData.level
        if (filterData.batch) query.batch = filterData.batch
      } else if (currentTab === 'inheritor') {
        collectionName = 'ich_inheritors'
        if (searchKeyword) {
          query.name = db.RegExp({ regexp: searchKeyword, options: 'i' })
        }
        if (filterData.level) query.level = filterData.level
      } else {
        collectionName = 'ich_news'
        if (searchKeyword) {
          query.title = db.RegExp({ regexp: searchKeyword, options: 'i' })
        }
        if (newsCategory) query.category = newsCategory
      }

      const skip = loadMore ? dataList.length : 0
      const res = await db.collection(collectionName)
        .where(query)
        .skip(skip)
        .limit(pageSize)
        .get()

      const newList = loadMore ? [...dataList, ...res.data] : res.data
      this.setData({
        dataList: newList,
        loading: false,
        noMore: res.data.length < pageSize
      })
    } catch (err) {
      console.error('加载数据失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败，请重试', icon: 'none' })
    }
  },

  goToDetail(e) {
    const { id, type } = e.currentTarget.dataset
    const urlMap = {
      project: `/pages/resource/project-detail?id=${id}`,
      inheritor: `/pages/resource/inheritor-detail?id=${id}`,
      news: `/pages/resource/news-detail?id=${id}`
    }
    wx.navigateTo({ url: urlMap[type] })
  },

  onPullDownRefresh() {
    this.setData({ dataList: [], noMore: false })
    this.loadData().then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    this.loadData(true)
  },

  onShareAppMessage() {
    return { title: '湘韵遗珍 - 非遗百科', path: '/pages/resource/list' }
  }
})
