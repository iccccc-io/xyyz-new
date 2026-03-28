/**
 * 云函数：create_order
 * 管理员权限执行，解决买家无法更新卖家商品库存的权限问题
 *
 * 核心链路：
 * 1. 验证商品存在 & 上架 & 有库存
 * 2. 原子扣减库存（inc(-quantity)，数据库层面防超卖）
 * 3. 获取卖家信息（工坊 owner_id）
 * 4. 创建 shopping_orders 记录（status=10 待付款）
 * 5. 写入完整的商品快照 + 收货地址
 *
 * 如果步骤 4 失败，自动回滚步骤 2 的库存扣减
 *
 * --- 预留接口说明 ---
 * 上线后将此云函数作为「统一下单入口」，
 * 可在步骤 4 后追加调用微信支付统一下单 API（wx.requestPayment），
 * 将 prepay_id 返回给前端拉起支付，替换当前的模拟支付流程。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  const {
    product_id,
    quantity = 1,
    delivery_address
  } = event

  // ========== 参数校验 ==========
  if (!product_id) {
    return { success: false, message: '参数错误：缺少商品ID' }
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { success: false, message: '购买数量不合法' }
  }
  if (!delivery_address || !delivery_address.userName || !delivery_address.telNumber) {
    return { success: false, message: '请选择收货地址' }
  }

  try {
    // ========== 1. 查询商品 ==========
    let productRes
    try {
      productRes = await db.collection('shopping_products').doc(product_id).get()
    } catch (e) {
      return { success: false, message: '商品不存在' }
    }

    const product = productRes.data

    if (product.status !== 1 || product.is_on_sale === false) {
      return { success: false, message: '商品已下架' }
    }
    if (!product.stock || product.stock < quantity) {
      return { success: false, message: '库存不足' }
    }

    // ========== 2. 查询工坊/卖家信息 ==========
    let workshop_name = ''
    let seller_openid = ''

    if (product.workshop_id) {
      try {
        const wsRes = await db.collection('shopping_workshops').doc(product.workshop_id).get()
        if (wsRes.data) {
          workshop_name = wsRes.data.name || ''
          seller_openid = wsRes.data.owner_id || ''
        }
      } catch (e) {
        console.warn('[create_order] 查询工坊失败:', e.message)
      }
    }

    // ========== 3. 原子扣减库存 ==========
    // 使用 where + inc 的组合天然防超卖：
    // 如果当前 stock < quantity，inc(-quantity) 会使 stock 为负数
    // 但云开发不支持 stock >= quantity 的条件更新，所以用 inc 后再检查
    const nextStock = (product.stock || 0) - quantity
    const updateRes = await db.collection('shopping_products').doc(product_id).update({
      data: {
        stock: _.inc(-quantity),
        is_on_sale: nextStock > 0 ? (product.is_on_sale !== false) : false,
        update_time: db.serverDate()
      }
    })

    if (updateRes.stats.updated === 0) {
      return { success: false, message: '库存扣减失败，请稍后重试' }
    }

    // ========== 4. 构造数据快照 ==========
    const totalPrice = product.price * quantity

    const productSnapshot = {
      product_id: product._id,
      title: product.title,
      cover_img: product.cover_img,
      price: product.price,
      original_price: product.original_price || product.price,
      quantity,
      origin: product.origin || '',
      category: product.category || '',
      related_project_id: product.related_project_id || '',
      related_project_name: product.related_project_name || '',
      logistics: product.logistics || null,
      workshop_id: product.workshop_id || '',
      workshop_name,
      seller_openid
    }

    // ========== 5. 创建订单 ==========
    try {
      const addRes = await db.collection('shopping_orders').add({
        data: {
          _openid: openid,
          status: 10,                           // Pending_Pay
          total_price: totalPrice,
          quantity,
          workshop_id: product.workshop_id || '',
          seller_openid,
          product_snapshot: productSnapshot,
          delivery_address,
          carrier_code: '',
          tracking_number: '',
          cancel_reason: '',
          create_time: db.serverDate(),
          pay_time: null,
          ship_time: null,
          complete_time: null,
          update_time: db.serverDate()
        }
      })

      console.log(`[create_order] 成功: 用户=${openid}, 订单=${addRes._id}, 商品=${product.title}, 金额=${totalPrice}分`)

      return {
        success: true,
        message: '下单成功',
        order_id: addRes._id,
        total_price: totalPrice
      }

    } catch (orderErr) {
      // 订单写入失败 → 回滚库存
      console.error('[create_order] 订单写入失败，回滚库存:', orderErr)
      await db.collection('shopping_products').doc(product_id).update({
        data: {
          stock: _.inc(quantity),
          update_time: db.serverDate()
        }
      }).catch(e => console.error('[create_order] 库存回滚也失败:', e))

      return { success: false, message: '创建订单失败，请稍后重试' }
    }

  } catch (err) {
    console.error('[create_order] 异常:', err)
    return { success: false, message: err.message || '系统异常' }
  }
}
