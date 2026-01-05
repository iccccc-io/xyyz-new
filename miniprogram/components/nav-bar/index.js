// components/nav-bar/index.js
// 沉浸式磨砂玻璃导航栏组件

Component({
  options: {
    multipleSlots: true
  },

  /**
   * 组件的属性列表
   */
  properties: {
    // 标题
    title: {
      type: String,
      value: ''
    },
    // 是否显示标题（用于滚动渐显效果）
    showTitle: {
      type: Boolean,
      value: false
    },
    // 是否显示返回按钮
    showBack: {
      type: Boolean,
      value: true
    },
    // 背景模式：'transparent'(透明) / 'solid'(实色)
    background: {
      type: String,
      value: 'transparent'
    },
    // 完全透明（无任何背景效果）
    transparent: {
      type: Boolean,
      value: false
    },
    // 深色模式（用于浅色背景）
    dark: {
      type: Boolean,
      value: false
    },
    // 是否显示占位元素
    placeholder: {
      type: Boolean,
      value: false
    },
    // 自定义样式
    customStyle: {
      type: String,
      value: ''
    },
    // 返回按钮点击的页面路径（可选，默认返回上一页）
    backUrl: {
      type: String,
      value: ''
    },
    // 返回按钮点击的delta（返回多少层）
    backDelta: {
      type: Number,
      value: 1
    }
  },

  /**
   * 组件的初始数据
   */
  data: {
    statusBarHeight: 20,
    navHeight: 44,
    capsuleWidth: 97
  },

  /**
   * 组件生命周期
   */
  lifetimes: {
    attached() {
      this.initNavInfo()
    }
  },

  /**
   * 组件的方法列表
   */
  methods: {
    /**
     * 初始化导航栏信息
     */
    initNavInfo() {
      try {
        // 获取系统信息
        const systemInfo = wx.getSystemInfoSync()
        const statusBarHeight = systemInfo.statusBarHeight || 20

        // 获取胶囊按钮信息
        const menuButton = wx.getMenuButtonBoundingClientRect()
        
        // 计算导航栏高度（胶囊按钮高度 + 上下边距）
        const navHeight = (menuButton.top - statusBarHeight) * 2 + menuButton.height
        
        // 胶囊按钮宽度（用于右侧占位对齐）
        const capsuleWidth = systemInfo.windowWidth - menuButton.left

        this.setData({
          statusBarHeight,
          navHeight: navHeight || 44,
          capsuleWidth: capsuleWidth || 97
        })
      } catch (err) {
        console.warn('获取导航栏信息失败:', err)
        // 使用默认值
        this.setData({
          statusBarHeight: 20,
          navHeight: 44,
          capsuleWidth: 97
        })
      }
    },

    /**
     * 返回按钮点击事件
     */
    onBack() {
      // 触发自定义事件
      this.triggerEvent('back')

      const { backUrl, backDelta } = this.properties

      if (backUrl) {
        // 指定了返回路径
        wx.navigateTo({
          url: backUrl,
          fail: () => {
            wx.redirectTo({ url: backUrl })
          }
        })
      } else {
        // 默认返回上一页
        wx.navigateBack({
          delta: backDelta,
          fail: () => {
            // 无法返回时跳转首页
            wx.switchTab({
              url: '/pages/home/home'
            })
          }
        })
      }
    }
  }
})

