/**
 * 云函数：manage_aftersale
 * 售后统一处理 — 管理员权限执行
 *
 * === 数据模型核心原则 ===
 * 1. 一单到底：一笔订单只能对应一条售后记录（order_id 唯一）
 * 2. 覆盖式更新：被拒绝/关闭后重新申请 = update 原记录，不新建
 * 3. 操作日志：operation_logs 数组记录每一次状态变更
 * 4. 重新申请上限：同一订单最多被拒绝后再申请 3 次
 *
 * === Actions ===
 * load_detail        管理员读取售后详情（买卖双方均可调用）
 * load_seller_list   管理员读取卖家的售后列表
 * apply              买家申请售后（首次创建或覆盖式重新提交）
 * cancel             买家撤销
 * approve            卖家同意退货
 * reject             卖家拒绝
 * ship_return        买家回填退货单号
 * confirm_return     卖家确认收到退货 → 退款
 * system_refund      系统自动退款（守护进程调用）
 *
 * === 售后状态机 ===
 *  0  待审核    1  待寄回    2  待验收    3  退款成功
 * -1  已拒绝   -2  售后关闭
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const AFTERSALE_WINDOW_DAYS = 7
const MAX_REAPPLY = 3

function getSafeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function findSkuIndex(product, skuId) {
  const skus = Array.isArray(product && product.skus) ? product.skus : []
  return skus.findIndex((item) => getSafeString(item && item.sku_id) === getSafeString(skuId))
}

function isPickupOrder(order = {}) {
  const logistics = (order.product_snapshot && order.product_snapshot.logistics) || {}
  return logistics.method === 'pickup' || order.carrier_code === 'pickup'
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const { action } = event

  try {
    switch (action) {
      case 'load_detail':      return await loadDetail(openid, event)
      case 'load_seller_list': return await loadSellerList(openid, event)
      case 'apply':            return await applyAftersale(openid, event)
      case 'cancel':           return await cancelAftersale(openid, event)
      case 'approve':          return await approveAftersale(openid, event)
      case 'reject':           return await rejectAftersale(openid, event)
      case 'ship_return':      return await shipReturn(openid, event)
      case 'confirm_return':   return await confirmReturn(openid, event, !!event._system)
      case 'system_refund':    return await systemRefund(event)
      default:
        return { success: false, message: `未知操作: ${action}` }
    }
  } catch (err) {
    console.error(`[manage_aftersale] action=${action} 异常:`, err)
    return { success: false, message: err.message || '服务端异常' }
  }
}

// =====================================================================
//  管理员读取：load_detail（买卖双方均可调用）
// =====================================================================
async function loadDetail(openid, event) {
  const { aftersale_id, order_id } = event

  let as = null
  if (aftersale_id) {
    as = await getDoc('shopping_aftersales', aftersale_id)
  } else if (order_id) {
    const res = await db.collection('shopping_aftersales')
      .where({ order_id })
      .orderBy('apply_time', 'desc')
      .limit(1).get()
    if (res.data && res.data.length > 0) as = res.data[0]
  }

  if (!as) return { success: false, message: '售后记录不存在' }

  // 权限校验：必须是买家或卖家
  if (openid && as.buyer_id !== openid && as.seller_id !== openid) {
    return { success: false, message: '无权查看此售后记录' }
  }

  // 加载关联订单
  let order = null
  try {
    const oRes = await db.collection('shopping_orders').doc(as.order_id).get()
    order = oRes.data
  } catch (_) {}

  // 明确返回角色
  // 关键：当 buyer_id === seller_id（同一人自测），用 view_as 区分视角
  let role = 'visitor'
  if (openid && as.buyer_id === openid && as.seller_id === openid) {
    role = event.view_as === 'seller' ? 'seller' : 'buyer'
  } else if (openid && as.buyer_id === openid) {
    role = 'buyer'
  } else if (openid && as.seller_id === openid) {
    role = 'seller'
  }

  return {
    success: true,
    role,
    detail: as,
    order
  }
}

// =====================================================================
//  管理员读取：load_seller_list
// =====================================================================
async function loadSellerList(openid, event) {
  const { status_filter, skip = 0, limit = 50, keyword = '', start_time = '', end_time = '' } = event

  if (!openid) return { success: false, message: '未登录' }

  const conditions = [{ seller_id: openid }]
  if (status_filter === 'active') {
    conditions.push({ status: _.in([0, 1, 2]) })
  } else if (status_filter === 'closed') {
    conditions.push({ status: _.in([3, -1, -2]) })
  }

  if (start_time) {
    const startDate = new Date(start_time)
    if (!Number.isNaN(startDate.getTime())) {
      conditions.push({ apply_time: _.gte(startDate) })
    }
  }

  if (end_time) {
    const endDate = new Date(end_time)
    if (!Number.isNaN(endDate.getTime())) {
      conditions.push({ apply_time: _.lt(endDate) })
    }
  }

  const where = conditions.length === 1 ? conditions[0] : _.and(conditions)

  const res = await db.collection('shopping_aftersales')
    .where(where)
    .orderBy('update_time', 'desc')
    .skip(skip)
    .limit(limit)
    .get()

  const list = res.data || []

  // 批量加载订单信息
  const orderIds = [...new Set(list.map(i => i.order_id))]
  const orderMap = {}
  for (const oid of orderIds) {
    try {
      const o = (await db.collection('shopping_orders').doc(oid).get()).data
      orderMap[oid] = {
        order_id: o._id || oid,
        title: (o.product_snapshot && o.product_snapshot.title) || '未知',
        cover_img: (o.product_snapshot && o.product_snapshot.cover_img) || '',
        buyer_name: (o.delivery_address && o.delivery_address.userName) || '',
        apply_time: o.create_time || null,
        is_pickup: isPickupOrder(o)
      }
    } catch (_) {
      orderMap[oid] = { order_id: oid, title: '已删除', cover_img: '', buyer_name: '', apply_time: null, is_pickup: false }
    }
  }

  const trimmedKeyword = getSafeString(keyword).toLowerCase()
  const filteredList = trimmedKeyword
    ? list.filter((item) => {
      const orderInfo = orderMap[item.order_id] || {}
      const searchableFields = [
        item.order_id,
        item._id,
        orderInfo.title,
        orderInfo.buyer_name
      ]

      return searchableFields.some((field) => getSafeString(field).toLowerCase().includes(trimmedKeyword))
    })
    : list

  return {
    success: true,
    list: filteredList,
    orderMap,
    total: filteredList.length
  }
}

// =====================================================================
//  买家申请售后（一单到底：首次创建 or 覆盖式重新提交）
// =====================================================================
async function applyAftersale(openid, event) {
  const { order_id, type, reason, proof_imgs } = event

  if (!order_id || !type || !reason) {
    return { success: false, message: '参数不完整' }
  }
  if (!['refund_only', 'return_refund'].includes(type)) {
    return { success: false, message: '无效的售后类型' }
  }

  // 1. 查询订单
  const order = await getDoc('shopping_orders', order_id)
  if (!order) return { success: false, message: '订单不存在' }
  if (order._openid !== openid) return { success: false, message: '无权操作此订单' }
  if (order.status !== 40) return { success: false, message: '当前订单状态不支持售后' }
  if (order.settled === true) return { success: false, message: '订单已结算，超出售后窗口期' }

  // 售后窗口期校验
  if (order.complete_time) {
    const end = new Date(order.complete_time).getTime() + AFTERSALE_WINDOW_DAYS * 24 * 3600 * 1000
    if (Date.now() > end) return { success: false, message: '已超过7天售后窗口期' }
  }

  const sellerOpenid = order.seller_openid || ''
  const refundFee = order.total_price
  const now = new Date()

  const logEntry = {
    operator: 'buyer',
    action: 'create',
    time: now.toISOString(),
    content: `买家发起售后申请，类型：${type === 'refund_only' ? '仅退款' : '退货退款'}，理由：${reason}`
  }

  // 2. 查找是否已存在该订单的售后记录
  const existRes = await db.collection('shopping_aftersales')
    .where({ order_id })
    .limit(1).get()

  if (existRes.data && existRes.data.length > 0) {
    const existing = existRes.data[0]

    // 存在进行中的售后 → 拒绝
    if ([0, 1, 2].includes(existing.status)) {
      return { success: false, message: '该订单已有进行中的售后申请' }
    }

    // 状态为 -1(已拒绝) 或 -2(已关闭) → 覆盖式重新提交
    if (existing.status === -1 || existing.status === -2) {
      // 检查重新申请次数
      const reapplyCount = existing.reapply_count || 0
      if (reapplyCount >= MAX_REAPPLY) {
        return { success: false, message: `该订单售后申请次数已达上限（最多${MAX_REAPPLY}次）` }
      }

      logEntry.action = 'reapply'
      logEntry.content = `买家第${reapplyCount + 1}次重新提交售后申请，理由：${reason}`

      // 覆盖更新原记录
      await db.collection('shopping_aftersales').doc(existing._id).update({
        data: {
          type,
          status: 0,
          reason,
          proof_imgs: proof_imgs || [],
          reject_reason: '',
          return_address: _.set(null),
          return_logistics: _.set(null),
          apply_time: db.serverDate(),
          approve_time: _.set(null),
          ship_time: _.set(null),
          complete_time: _.set(null),
          close_time: _.set(null),
          reapply_count: _.inc(1),
          operation_logs: _.push(logEntry),
          update_time: db.serverDate()
        }
      })

      // 标记订单有活跃售后
      await db.collection('shopping_orders').doc(order_id).update({
        data: { has_aftersale: true, update_time: db.serverDate() }
      })

      console.log(`[售后] 重新申请: ${existing._id}, 第${reapplyCount + 1}次`)
      return { success: true, message: '售后申请已重新提交', aftersale_id: existing._id }
    }

    // 状态为 3(退款成功) → 不可再申请
    return { success: false, message: '该订单售后已完结，不可重复申请' }
  }

  // 3. 首次创建
  const addRes = await db.collection('shopping_aftersales').add({
    data: {
      _openid: openid,
      order_id,
      buyer_id: openid,
      seller_id: sellerOpenid,
      type,
      status: 0,
      refund_fee: refundFee,
      reason,
      proof_imgs: proof_imgs || [],
      return_address: null,
      return_logistics: null,
      reject_reason: '',
      reapply_count: 0,
      operation_logs: [logEntry],
      apply_time: db.serverDate(),
      approve_time: null,
      ship_time: null,
      complete_time: null,
      close_time: null,
      update_time: db.serverDate()
    }
  })

  await db.collection('shopping_orders').doc(order_id).update({
    data: { has_aftersale: true, update_time: db.serverDate() }
  })

  console.log(`[售后] 首次申请: ${addRes._id}, order=${order_id}`)
  return { success: true, message: '售后申请已提交', aftersale_id: addRes._id }
}

// =====================================================================
//  买家撤销售后
// =====================================================================
async function cancelAftersale(openid, event) {
  const { aftersale_id } = event
  if (!aftersale_id) return { success: false, message: '参数错误' }

  const as = await getDoc('shopping_aftersales', aftersale_id)
  if (!as) return { success: false, message: '售后记录不存在' }
  if (as.buyer_id !== openid) return { success: false, message: '无权操作' }
  if (![0, 1].includes(as.status)) return { success: false, message: '当前状态不可撤销' }

  await db.collection('shopping_aftersales').doc(aftersale_id).update({
    data: {
      status: -2,
      close_time: db.serverDate(),
      operation_logs: _.push({
        operator: 'buyer', action: 'cancel',
        time: new Date().toISOString(),
        content: '买家主动撤销了售后申请'
      }),
      update_time: db.serverDate()
    }
  })

  await db.collection('shopping_orders').doc(as.order_id).update({
    data: { has_aftersale: false, update_time: db.serverDate() }
  })

  return { success: true, message: '已撤销售后申请' }
}

// =====================================================================
//  卖家同意退货
// =====================================================================
async function approveAftersale(openid, event) {
  const { aftersale_id, return_address } = event
  if (!aftersale_id) return { success: false, message: '参数错误' }

  const as = await getDoc('shopping_aftersales', aftersale_id)
  if (!as) return { success: false, message: '售后记录不存在' }
  if (as.seller_id !== openid) return { success: false, message: '无权操作：您不是该订单的卖家' }
  if (as.status !== 0) return { success: false, message: '当前状态不可审批' }
  const order = await getDoc('shopping_orders', as.order_id)
  const pickupOrder = isPickupOrder(order)

  // 仅退款 → 直接退款
  if (as.type === 'refund_only') {
    // 先写日志再退款
    await db.collection('shopping_aftersales').doc(aftersale_id).update({
      data: {
        operation_logs: _.push({
          operator: 'seller', action: 'approve_refund',
          time: new Date().toISOString(),
          content: '卖家同意仅退款申请，系统执行退款'
        }),
        approve_time: db.serverDate(),
        update_time: db.serverDate()
      }
    })
    return await executeRefund(as, aftersale_id, '卖家同意仅退款')
  }

  if (pickupOrder) {
    await db.collection('shopping_aftersales').doc(aftersale_id).update({
      data: {
        status: 1,
        return_address: _.set(null),
        approve_time: db.serverDate(),
        operation_logs: _.push({
          operator: 'seller', action: 'approve',
          time: new Date().toISOString(),
          content: '卖家同意退货，买家可通过同城自提方式当面交还商品'
        }),
        update_time: db.serverDate()
      }
    })

    return { success: true, message: '已同意退货，等待买家交还商品' }
  }

  // 退货退款 → 需要退货地址
  if (!return_address || !return_address.name || !return_address.phone || !return_address.detail) {
    return { success: false, message: '请提供完整的退货地址' }
  }

  await db.collection('shopping_aftersales').doc(aftersale_id).update({
    data: {
      status: 1,
      return_address: _.set(return_address),
      approve_time: db.serverDate(),
      operation_logs: _.push({
        operator: 'seller', action: 'approve',
        time: new Date().toISOString(),
        content: `卖家同意退货，退货地址：${return_address.name} ${return_address.phone} ${return_address.detail}`
      }),
      update_time: db.serverDate()
    }
  })

  return { success: true, message: '已同意退货，等待买家寄回' }
}

// =====================================================================
//  卖家拒绝
// =====================================================================
async function rejectAftersale(openid, event) {
  const { aftersale_id, reject_reason } = event
  if (!aftersale_id) return { success: false, message: '参数错误' }
  if (!reject_reason || reject_reason.trim().length < 2) {
    return { success: false, message: '请填写拒绝原因' }
  }

  const as = await getDoc('shopping_aftersales', aftersale_id)
  if (!as) return { success: false, message: '售后记录不存在' }
  if (as.seller_id !== openid) return { success: false, message: '无权操作：您不是该订单的卖家' }
  if (as.status !== 0) return { success: false, message: '当前状态不可拒绝' }

  await db.collection('shopping_aftersales').doc(aftersale_id).update({
    data: {
      status: -1,
      reject_reason: reject_reason.trim(),
      operation_logs: _.push({
        operator: 'seller', action: 'reject',
        time: new Date().toISOString(),
        content: `卖家拒绝了售后申请，理由：${reject_reason.trim()}`
      }),
      update_time: db.serverDate()
    }
  })

  // 重置订单 has_aftersale，让自动结算守护进程能正常工作
  // 买家仍可通过 reapply 机制再次提交（云函数会自动查找历史记录）
  await db.collection('shopping_orders').doc(as.order_id).update({
    data: { has_aftersale: false, update_time: db.serverDate() }
  })

  return { success: true, message: '已拒绝售后申请' }
}

// =====================================================================
//  买家回填退货单号
// =====================================================================
async function shipReturn(openid, event) {
  const { aftersale_id, logistics_com, logistics_num } = event
  if (!aftersale_id) return { success: false, message: '参数错误' }

  const as = await getDoc('shopping_aftersales', aftersale_id)
  if (!as) return { success: false, message: '售后记录不存在' }
  if (as.buyer_id !== openid) return { success: false, message: '无权操作' }
  if (as.status !== 1) return { success: false, message: '当前状态不可填写物流' }
  const order = await getDoc('shopping_orders', as.order_id)
  const pickupOrder = isPickupOrder(order)

  if (!pickupOrder && (!logistics_com || !logistics_num || logistics_num.trim().length < 5)) {
    return { success: false, message: '请填写有效的快递公司和单号' }
  }

  await db.collection('shopping_aftersales').doc(aftersale_id).update({
    data: {
      status: 2,
      return_logistics: _.set(pickupOrder
        ? { mode: 'pickup', label: '同城自提' }
        : { com: logistics_com, num: logistics_num.trim() }),
      ship_time: db.serverDate(),
      operation_logs: _.push({
        operator: 'buyer', action: 'ship_return',
        time: new Date().toISOString(),
        content: pickupOrder
          ? '买家已确认通过同城自提方式交还商品，等待卖家确认'
          : `买家已寄出退货，快递：${logistics_com}，单号：${logistics_num.trim()}`
      }),
      update_time: db.serverDate()
    }
  })

  return { success: true, message: pickupOrder ? '已确认交还商品' : '退货单号已提交' }
}

// =====================================================================
//  卖家确认收到退货 → 退款
// =====================================================================
async function confirmReturn(openid, event, isSystem) {
  const { aftersale_id } = event
  if (!aftersale_id) return { success: false, message: '参数错误' }

  const as = await getDoc('shopping_aftersales', aftersale_id)
  if (!as) return { success: false, message: '售后记录不存在' }

  if (!isSystem && as.seller_id !== openid) {
    return { success: false, message: '无权操作：您不是该订单的卖家' }
  }
  if (as.status !== 2) return { success: false, message: '当前状态不可确认' }

  // 写日志
  await db.collection('shopping_aftersales').doc(aftersale_id).update({
    data: {
      operation_logs: _.push({
        operator: isSystem ? 'system' : 'seller',
        action: 'confirm_return',
        time: new Date().toISOString(),
        content: isSystem ? '卖家10天未验收，系统自动确认退货并执行退款' : '卖家确认收到退货，执行退款'
      }),
      update_time: db.serverDate()
    }
  })

  return await executeRefund(as, aftersale_id,
    isSystem ? '系统自动退款' : '卖家确认退货')
}

/**
 * 系统自动退款（守护进程调用 — 仅退款类型被自动通过时）
 */
async function systemRefund(event) {
  const { aftersale_id } = event
  if (!aftersale_id) return { success: false, message: '参数错误' }

  const as = await getDoc('shopping_aftersales', aftersale_id)
  if (!as) return { success: false, message: '售后记录不存在' }

  await db.collection('shopping_aftersales').doc(aftersale_id).update({
    data: {
      operation_logs: _.push({
        operator: 'system', action: 'auto_refund',
        time: new Date().toISOString(),
        content: '卖家48小时未处理仅退款申请，系统自动退款'
      }),
      update_time: db.serverDate()
    }
  })

  return await executeRefund(as, aftersale_id, '系统自动退款')
}

// =====================================================================
//  核心退款事务
// =====================================================================
async function executeRefund(as, aftersale_id, triggerDesc) {
  const { order_id, buyer_id, seller_id, refund_fee } = as

  const order = await getDoc('shopping_orders', order_id)
  if (!order) return { success: false, message: '关联订单不存在' }

  const sellerWalletRes = await db.collection('shopping_wallets')
    .where({ _openid: seller_id }).limit(1).get()
  if (!sellerWalletRes.data || sellerWalletRes.data.length === 0) {
    return { success: false, message: '卖家钱包不存在' }
  }
  const sellerWallet = sellerWalletRes.data[0]

  let buyerWalletRes = await db.collection('shopping_wallets')
    .where({ _openid: buyer_id }).limit(1).get()
  if (!buyerWalletRes.data || buyerWalletRes.data.length === 0) {
    await db.collection('shopping_wallets').add({
      data: {
        _openid: buyer_id, balance: 0, frozen_balance: 0,
        settling_balance: 0, pay_password: '', status: 1,
        create_time: db.serverDate(), update_time: db.serverDate()
      }
    })
    buyerWalletRes = await db.collection('shopping_wallets')
      .where({ _openid: buyer_id }).limit(1).get()
  }
  const buyerWallet = buyerWalletRes.data[0]

  const productId = order.product_snapshot && order.product_snapshot.product_id
  const skuId = order.product_snapshot && order.product_snapshot.sku_id
  const quantity = order.quantity || 1

  const transaction = await db.startTransaction()
  try {
    await transaction.collection('shopping_wallets').doc(sellerWallet._id).update({
      data: { settling_balance: _.inc(-refund_fee), update_time: db.serverDate() }
    })
    await transaction.collection('shopping_wallets').doc(buyerWallet._id).update({
      data: { balance: _.inc(refund_fee), update_time: db.serverDate() }
    })
    await transaction.collection('shopping_aftersales').doc(aftersale_id).update({
      data: {
        status: 3,
        complete_time: db.serverDate(),
        operation_logs: _.push({
          operator: 'system', action: 'refund_success',
          time: new Date().toISOString(),
          content: `退款成功，¥${(refund_fee / 100).toFixed(2)} 已退回买家钱包（${triggerDesc}）`
        }),
        update_time: db.serverDate()
      }
    })
    await transaction.collection('shopping_orders').doc(order_id).update({
      data: { status: 60, settled: true, has_aftersale: false, aftersale_result: 'refunded', update_time: db.serverDate() }
    })

    if (productId && quantity > 0) {
      const productRes = await transaction.collection('shopping_products').doc(productId).get()
      const product = productRes.data
      const skuIndex = findSkuIndex(product, skuId)
      if (skuIndex < 0) {
        throw new Error('订单对应的商品款式不存在，无法回滚库存')
      }

      await transaction.collection('shopping_products').doc(productId).update({
        data: {
          total_stock: _.inc(quantity),
          [`skus.${skuIndex}.stock`]: _.inc(quantity),
          update_time: db.serverDate()
        }
      })
    }

    await transaction.commit()
    console.log(`[退款] 成功: 售后=${aftersale_id}, 退款=${refund_fee}分`)
  } catch (txErr) {
    await transaction.rollback()
    console.error('[退款] 事务回滚:', txErr)
    return { success: false, message: '退款处理失败，请稍后重试' }
  }

  // 事务外：库存回滚 + 账本
  const productTitle = (order.product_snapshot && order.product_snapshot.title) || '未知商品'
  await Promise.all([
    db.collection('shopping_ledger').add({ data: {
      order_id, user_id: buyer_id, type: 'REFUND_IN', amount: refund_fee,
      description: `售后退款到账：${productTitle}`, create_time: db.serverDate()
    }}),
    db.collection('shopping_ledger').add({ data: {
      order_id, user_id: seller_id, type: 'REFUND_OUT', amount: -refund_fee,
      description: `售后退款扣除：${productTitle}`, create_time: db.serverDate()
    }})
  ]).catch(e => console.warn('[退款] 账本写入失败:', e))

  return { success: true, message: '退款成功' }
}

// =====================================================================
async function getDoc(collection, docId) {
  try {
    return (await db.collection(collection).doc(docId).get()).data
  } catch (e) { return null }
}
