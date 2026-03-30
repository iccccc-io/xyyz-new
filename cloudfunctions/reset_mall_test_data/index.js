const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

const CLEAR_COLLECTIONS = [
  'shopping_products',
  'shopping_orders',
  'shopping_reviews',
  'shopping_aftersales',
  'shopping_pay_records',
  'shopping_ledger'
]

async function listIds(collectionName, batchSize = 100) {
  const ids = []
  let skip = 0

  while (true) {
    const res = await db.collection(collectionName)
      .skip(skip)
      .limit(batchSize)
      .field({ _id: true })
      .get()

    const docs = res.data || []
    if (!docs.length) break

    ids.push(...docs.map((item) => item._id))

    if (docs.length < batchSize) break
    skip += batchSize
  }

  return ids
}

async function removeAllDocuments(collectionName, batchSize = 50) {
  const ids = await listIds(collectionName, 100)
  let removed = 0

  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = ids.slice(index, index + batchSize)
    await Promise.all(batch.map((id) => db.collection(collectionName).doc(id).remove()))
    removed += batch.length
  }

  return removed
}

async function resetCollectionFields(collectionName, data, batchSize = 50) {
  const ids = await listIds(collectionName, 100)
  let updated = 0

  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = ids.slice(index, index + batchSize)
    await Promise.all(batch.map((id) => db.collection(collectionName).doc(id).update({
      data: {
        ...data,
        update_time: db.serverDate()
      }
    })))
    updated += batch.length
  }

  return updated
}

exports.main = async () => {
  const summary = {
    cleared: {},
    workshopsReset: 0,
    walletsReset: 0
  }

  try {
    for (const collectionName of CLEAR_COLLECTIONS) {
      summary.cleared[collectionName] = await removeAllDocuments(collectionName)
    }

    summary.workshopsReset = await resetCollectionFields('shopping_workshops', {
      product_count: 0,
      total_sales: 0,
      rating: 0,
      shop_rating: 0,
      shop_review_count: 0,
      last_rename_time: null,
      rating_details: {
        service: 0,
        logistics: 0,
        quality: 0
      }
    })

    summary.walletsReset = await resetCollectionFields('shopping_wallets', {
      balance: 10000,
      frozen_balance: 0,
      settling_balance: 0
    })

    return {
      success: true,
      message: '商城测试数据已重置',
      summary
    }
  } catch (error) {
    console.error('[reset_mall_test_data]', error)
    return {
      success: false,
      message: error.message || '重置失败',
      summary
    }
  }
}
