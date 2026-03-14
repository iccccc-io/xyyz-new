// components/pay-keyboard/index.js
Component({
  /**
   * 对外属性
   * show         - 是否显示
   * title        - 标题文字
   * amountDisplay - 显示金额（字符串，如 "12.50"）
   * loading      - 是否处于验证中（禁用键盘输入）
   */
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '请输入支付密码' },
    amountDisplay: { type: String, value: '0.00' },
    loading: { type: Boolean, value: false }
  },

  data: {
    passwordArr: [],
    errorMsg: '',
    hintMsg: '',
    // 静态：6 个点的索引数组（WXML 中 wx:for 无法直接用数字）
    dotIndexes: [0, 1, 2, 3, 4, 5],
    // 键盘布局：3×4，最后一行为 空/0/del
    keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del']
  },

  methods: {
    /** 点击遮罩：关闭 */
    onMaskTap() {
      if (this.data.loading) return
      this.onClose()
    },

    /** 关闭键盘，重置状态 */
    onClose() {
      this.resetState()
      this.triggerEvent('close')
    },

    /** 按键点击 */
    onKeyTap(e) {
      if (this.data.loading) return

      const key = e.currentTarget.dataset.key
      if (key === '') return // 空白键位

      if (key === 'del') {
        const arr = this.data.passwordArr
        if (arr.length > 0) {
          this.setData({ passwordArr: arr.slice(0, -1), errorMsg: '' })
        }
        return
      }

      const arr = this.data.passwordArr
      if (arr.length >= 6) return

      const newArr = [...arr, key]
      this.setData({ passwordArr: newArr, errorMsg: '' })

      if (newArr.length === 6) {
        // 密码输入满 6 位，触发 confirm 事件
        this.triggerEvent('confirm', { password: newArr.join('') })
      }
    },

    /** 由父组件调用：显示错误信息并清空密码 */
    setError(msg) {
      this.setData({ passwordArr: [], errorMsg: msg, hintMsg: '' })
    },

    /** 由父组件调用：显示提示信息 */
    setHint(msg) {
      this.setData({ hintMsg: msg, errorMsg: '' })
    },

    /** 完全重置 */
    resetState() {
      this.setData({ passwordArr: [], errorMsg: '', hintMsg: '' })
    }
  }
})
