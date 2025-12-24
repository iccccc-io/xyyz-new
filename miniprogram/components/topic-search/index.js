// components/topic-search/index.js
const db = wx.cloud.database()

Component({
  /**
   * 组件的属性列表
   */
  properties: {
    // 是否显示
    show: {
      type: Boolean,
      value: false
    },
    // 已选中的标签列表（用于去重）
    selectedTags: {
      type: Array,
      value: []
    },
    // 最大标签数量
    maxCount: {
      type: Number,
      value: 10
    }
  },

  /**
   * 组件的初始数据
   */
  data: {
    keyword: '',           // 搜索关键词
    searchResults: [],     // 搜索结果
    hotTopics: [],         // 热门话题
    loading: false,        // 加载状态
    searchTimer: null      // 防抖定时器
  },

  /**
   * 组件生命周期
   */
  lifetimes: {
    attached() {
      // 组件加载时获取热门话题
      this.loadHotTopics()
    }
  },

  /**
   * 监听属性变化
   */
  observers: {
    'show': function(show) {
      if (show) {
        // 每次打开时刷新热门话题
        this.loadHotTopics()
        // 清空搜索状态
        this.setData({
          keyword: '',
          searchResults: []
        })
      }
    }
  },

  /**
   * 组件的方法列表
   */
  methods: {
    /**
     * 加载热门话题
     */
    async loadHotTopics() {
      try {
        const res = await db.collection('community_topics')
          .orderBy('count', 'desc')
          .limit(20)
          .get()

        const hotTopics = (res.data || []).map(item => ({
          ...item,
          countFormatted: this.formatCount(item.count || 0)
        }))

        this.setData({ hotTopics })
      } catch (err) {
        console.error('加载热门话题失败:', err)
      }
    },

    /**
     * 输入框输入事件（带防抖）
     */
    onInput(e) {
      const keyword = e.detail.value.trim()
      this.setData({ keyword })

      // 清除之前的定时器
      if (this.data.searchTimer) {
        clearTimeout(this.data.searchTimer)
      }

      // 空关键词不搜索
      if (!keyword) {
        this.setData({ searchResults: [] })
        return
      }

      // 防抖：300ms 后执行搜索
      const timer = setTimeout(() => {
        this.searchTopics(keyword)
      }, 300)

      this.setData({ searchTimer: timer })
    },

    /**
     * 搜索话题
     */
    async searchTopics(keyword) {
      if (!keyword) return

      this.setData({ loading: true })

      try {
        // 使用正则进行模糊匹配（前缀匹配）
        const res = await db.collection('community_topics')
          .where({
            name: db.RegExp({
              regexp: keyword,
              options: 'i'  // 不区分大小写
            })
          })
          .orderBy('count', 'desc')
          .limit(20)
          .get()

        const searchResults = (res.data || []).map(item => ({
          ...item,
          countFormatted: this.formatCount(item.count || 0)
        }))

        this.setData({
          searchResults,
          loading: false
        })

      } catch (err) {
        console.error('搜索话题失败:', err)
        this.setData({ loading: false })
      }
    },

    /**
     * 确认搜索
     */
    onSearch() {
      if (this.data.keyword) {
        this.searchTopics(this.data.keyword)
      }
    },

    /**
     * 清空关键词
     */
    clearKeyword() {
      this.setData({
        keyword: '',
        searchResults: []
      })
    },

    /**
     * 选择已有话题
     */
    onSelectTopic(e) {
      const topic = e.currentTarget.dataset.topic
      this.selectTopic(topic.name, false)
    },

    /**
     * 创建新话题
     */
    onCreateTopic() {
      const keyword = this.data.keyword.trim()
      if (!keyword) return
      
      // 检查字符长度
      if (keyword.length > 15) {
        wx.showToast({
          title: '话题名称不能超过15个字符',
          icon: 'none'
        })
        return
      }

      this.selectTopic(keyword, true)
    },

    /**
     * 选中话题的通用处理
     */
    selectTopic(name, isNew) {
      // 检查是否已达到最大数量
      if (this.properties.selectedTags.length >= this.properties.maxCount) {
        wx.showToast({
          title: `最多添加${this.properties.maxCount}个话题`,
          icon: 'none'
        })
        return
      }

      // 去重检查（忽略大小写和空格）
      const normalizedName = name.toLowerCase().replace(/\s+/g, '')
      const isDuplicate = this.properties.selectedTags.some(tag => 
        tag.toLowerCase().replace(/\s+/g, '') === normalizedName
      )

      if (isDuplicate) {
        wx.showToast({
          title: '该话题已添加',
          icon: 'none'
        })
        return
      }

      // 触发选中事件
      this.triggerEvent('select', {
        name: name,
        isNew: isNew
      })

      // 关闭弹窗
      this.onClose()
    },

    /**
     * 关闭弹窗
     */
    onClose() {
      this.triggerEvent('close')
    },

    /**
     * 格式化数量显示
     */
    formatCount(num) {
      if (num >= 10000) {
        return (num / 10000).toFixed(1) + 'w'
      } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'k'
      }
      return String(num)
    }
  }
})

