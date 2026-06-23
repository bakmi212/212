'use client'

import { useEffect, useState, useCallback } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader as Loader2, Package, Clock, CircleCheck as CheckCircle, Circle as XCircle, CircleAlert as AlertCircle, Upload, Trash2, Eye } from 'lucide-react'
import { formatIDR } from '@/lib/purchase-context'
import { toast } from 'sonner'

const BUCKET_NAME = 'payment-proofs'

interface Order {
  id: string
  order_number: string
  total_amount: number
  status: string
  payment_status: string
  payment_method: string
  payment_proof: string | null
  created_at: string
  order_items: {
    id: string
    product_name: string | null
    variant_name: string | null
    product: { name: string }
  }[]
}

interface OrderRow {
  id: string
  order_number: string
  total_amount: number
  status: string
  payment_status: string
  payment_method: string
  payment_proof: string | null
  created_at: string
  order_items: {
    id: string
    product_name: string | null
    variant_name: string | null
    product: { name: string }[]
  }[]
}

export default function MemberOrdersPage() {
  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState<Order[]>([])
  const [filter, setFilter] = useState('all')
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const supabase = createBrowserClient()

  const fetchOrders = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    let query = supabase
      .from('orders')
      .select(`
        id, order_number, total_amount, status, payment_status,
        payment_method, payment_proof, created_at,
        order_items(id, product_name, variant_name, product:products(name))
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (filter !== 'all') {
      query = query.eq('payment_status', filter)
    }

    const { data } = await query
    const formatted: Order[] = (data as OrderRow[])?.map(row => ({
      ...row,
      order_items: (row.order_items || []).map(item => ({
        id: item.id,
        product_name: item.product_name,
        variant_name: item.variant_name,
        product: item.product?.[0] || { name: '-' }
      }))
    })) || []

    setOrders(formatted)
    setLoading(false)
  }, [filter, supabase])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel('member-orders-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders'
        },
        () => fetchOrders()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchOrders, supabase])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
      case 'completed':
        return 'bg-emerald-100 text-emerald-700'
      case 'pending':
        return 'bg-amber-100 text-amber-700'
      case 'processing':
        return 'bg-blue-100 text-blue-700'
      case 'cancelled':
        return 'bg-red-100 text-red-700'
      default:
        return 'bg-slate-100 text-slate-700'
    }
  }

  const getPaymentStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'bg-emerald-100 text-emerald-700'
      case 'pending_payment':
        return 'bg-amber-100 text-amber-700'
      case 'pending_verification':
        return 'bg-blue-100 text-blue-700'
      case 'rejected':
        return 'bg-red-100 text-red-700'
      default:
        return 'bg-slate-100 text-slate-700'
    }
  }

  const getPaymentStatusIcon = (status: string) => {
    switch (status) {
      case 'paid':
        return <CheckCircle className="h-4 w-4" />
      case 'pending_payment':
        return <Clock className="h-4 w-4" />
      case 'pending_verification':
        return <AlertCircle className="h-4 w-4" />
      case 'rejected':
        return <XCircle className="h-4 w-4" />
      default:
        return <Clock className="h-4 w-4" />
    }
  }

  const filters = [
    { value: 'all', label: 'All' },
    { value: 'pending_payment', label: 'Pending Payment' },
    { value: 'pending_verification', label: 'Pending Verification' },
    { value: 'paid', label: 'Paid' }
  ]

  const handleProofFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    if (!validTypes.includes(file.type)) {
      toast.error('Format file tidak didukung. Gunakan JPG, PNG, atau WebP.')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Ukuran file maksimal 5MB')
      return
    }

    setProofFile(file)
  }

  const handleUploadProof = async () => {
    if (!proofFile || !selectedOrder) return

    setUploading(true)

    const filePath = `proofs/${selectedOrder.id}/${Date.now()}_${proofFile.name}`

    console.log('========== UPLOAD PROOF START ==========')
    console.log('File:', proofFile.name)
    console.log('File size:', proofFile.size, 'bytes')
    console.log('File type:', proofFile.type)
    console.log('Bucket:', BUCKET_NAME)
    console.log('Upload path:', filePath)

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, proofFile, {
        cacheControl: '3600',
        upsert: false
      })

    console.log('Supabase upload response:')
    console.log('  data:', uploadData)
    console.log('  error:', uploadError)

    if (uploadError) {
      console.error('========== UPLOAD ERROR ==========')
      console.error('Error message:', uploadError.message)
      console.error('Error name:', uploadError.name)
      console.error('Full error object:', JSON.stringify(uploadError, null, 2))

      const errorMsg = uploadError.message || JSON.stringify(uploadError) || 'Unknown upload error'

      if (uploadError.message?.includes('Bucket not found')) {
        toast.error(`Bucket "${BUCKET_NAME}" tidak ditemukan. Hubungi admin.`)
      } else if (uploadError.message?.includes('policy') || uploadError.message?.includes('permission')) {
        toast.error(`Tidak ada izin upload ke bucket "${BUCKET_NAME}". Periksa RLS policy.`)
      } else {
        toast.error(`Upload gagal: ${errorMsg}`)
      }

      setUploading(false)
      return
    }

    console.log('========== UPLOAD SUCCESS ==========')
    const proofUrl = supabase.storage.from(BUCKET_NAME).getPublicUrl(filePath).data.publicUrl
    console.log('Proof URL:', proofUrl)

    const { data: updateData, error: updateError } = await supabase
      .from('orders')
      .update({
        payment_proof: proofUrl,
        payment_status: 'pending_verification'
      })
      .eq('id', selectedOrder.id)
      .select()

    console.log('Order update response:')
    console.log('  data:', updateData)
    console.log('  error:', updateError)

    if (updateError) {
      console.error('========== ORDER UPDATE ERROR ==========')
      console.error('Error message:', updateError.message)
      console.error('Full error:', JSON.stringify(updateError, null, 2))
      toast.error(`Gagal menyimpan bukti: ${updateError.message}`)
    } else {
      toast.success('Bukti pembayaran berhasil diupload')
      setProofFile(null)
      fetchOrders()
      setSelectedOrder(null)
    }

    setUploading(false)
    console.log('========== UPLOAD PROOF END ==========')
  }

  const canUploadProof = (order: Order) => {
    return order.payment_status === 'pending_payment' || order.payment_status === 'pending_verification'
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold">My Orders</h1>
        <p className="text-muted-foreground">{orders.length} orders</p>
      </div>

      <div className="flex gap-2 mb-6">
        {filters.map(f => (
          <Button
            key={f.value}
            variant={filter === f.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {orders.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="h-12 w-12 mx-auto mb-3 text-slate-300" />
            <p className="text-muted-foreground">Belum ada order</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {orders.map(order => (
            <Card
              key={order.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setSelectedOrder(order)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-mono font-medium">{order.order_number}</div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {new Date(order.created_at).toLocaleDateString('id-ID', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                      })}
                    </div>
                    <div className="mt-2">
                      {order.order_items.map(item => (
                        <div key={item.id} className="text-sm">
                          <span className="font-medium">{item.product_name || item.product?.name}</span>
                          {item.variant_name && (
                            <span className="text-blue-600 ml-1">({item.variant_name})</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold">{formatIDR(order.total_amount)}</div>
                    <div className="mt-2">
                      <Badge className={getPaymentStatusColor(order.payment_status)}>
                        <span className="flex items-center gap-1">
                          {getPaymentStatusIcon(order.payment_status)}
                          {order.payment_status?.replace(/_/g, ' ')}
                        </span>
                      </Badge>
                    </div>
                    <div className="mt-1">
                      <Badge className={getStatusColor(order.status)}>
                        {order.status}
                      </Badge>
                    </div>
                    {order.payment_status === 'pending_payment' && !order.payment_proof && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 text-green-600 border-green-200 hover:bg-green-50"
                        onClick={(e) => { e.stopPropagation(); setSelectedOrder(order) }}
                      >
                        <Upload className="h-3 w-3 mr-1" />
                        Upload Bukti
                      </Button>
                    )}
                    {order.payment_status === 'pending_verification' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 text-blue-600 border-blue-200 hover:bg-blue-50"
                        onClick={(e) => { e.stopPropagation(); setSelectedOrder(order) }}
                      >
                        {order.payment_proof ? (
                          <>
                            <Trash2 className="h-3 w-3 mr-1" />
                            Ganti Bukti
                          </>
                        ) : (
                          <>
                            <Upload className="h-3 w-3 mr-1" />
                            Upload Bukti
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Order Detail</h3>
              <button onClick={() => { setSelectedOrder(null); setProofFile(null) }}>
                <span className="text-slate-400 text-xl">&times;</span>
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between py-2 border-b">
                <span className="text-slate-500">Order Number</span>
                <span className="font-mono font-medium">{selectedOrder.order_number}</span>
              </div>

              <div className="flex justify-between py-2 border-b">
                <span className="text-slate-500">Created</span>
                <span>{new Date(selectedOrder.created_at).toLocaleString()}</span>
              </div>

              <div className="py-2 border-b">
                <span className="text-slate-500">Product</span>
                <div className="mt-2">
                  {selectedOrder.order_items.map(item => (
                    <div key={item.id}>
                      <div className="font-medium">{item.product_name || item.product?.name}</div>
                      {item.variant_name && (
                        <div className="text-sm text-blue-600">Variant: {item.variant_name}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-between py-2 border-b">
                <span className="text-slate-500">Total</span>
                <span className="font-bold text-lg">{formatIDR(selectedOrder.total_amount)}</span>
              </div>

              <div className="flex justify-between py-2 border-b">
                <span className="text-slate-500">Payment Status</span>
                <Badge className={getPaymentStatusColor(selectedOrder.payment_status)}>
                  <span className="flex items-center gap-1">
                    {getPaymentStatusIcon(selectedOrder.payment_status)}
                    {selectedOrder.payment_status?.replace(/_/g, ' ')}
                  </span>
                </Badge>
              </div>

              <div className="flex justify-between py-2 border-b">
                <span className="text-slate-500">Order Status</span>
                <Badge className={getStatusColor(selectedOrder.status)}>
                  {selectedOrder.status}
                </Badge>
              </div>

              <div className="flex justify-between py-2 border-b">
                <span className="text-slate-500">Payment Method</span>
                <span>{selectedOrder.payment_method || '-'}</span>
              </div>

              {selectedOrder.payment_proof && (
                <div className="py-2">
                  <span className="text-slate-500 text-sm">Payment Proof:</span>
                  <div className="mt-2 relative">
                    <img
                      src={selectedOrder.payment_proof}
                      alt="Proof"
                      className="w-full max-h-48 object-contain rounded border"
                    />
                    <a
                      href={selectedOrder.payment_proof}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute bottom-2 right-2 px-2 py-1 bg-white rounded text-xs text-blue-600 hover:bg-blue-50 shadow"
                    >
                      <Eye className="h-3 w-3 inline mr-1" />Buka Full
                    </a>
                  </div>
                </div>
              )}

              {/* Upload Proof Section - only for pending orders */}
              {canUploadProof(selectedOrder) && (
                <div className="py-4 border-t">
                  <h4 className="font-medium mb-3">Upload Bukti Pembayaran</h4>

                  {selectedOrder.payment_proof && (
                    <p className="text-sm text-amber-600 mb-2">
                      Upload ulang akan mengganti bukti yang ada.
                    </p>
                  )}

                  <div className="space-y-3">
                    <input
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/webp"
                      onChange={handleProofFileSelect}
                      className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />

                    {proofFile && (
                      <div className="p-3 bg-slate-50 rounded-lg">
                        <p className="text-sm font-medium">{proofFile.name}</p>
                        <p className="text-xs text-slate-500">{(proofFile.size / 1024).toFixed(1)} KB</p>
                      </div>
                    )}

                    <Button
                      onClick={handleUploadProof}
                      disabled={!proofFile || uploading}
                      className="w-full"
                    >
                      {uploading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Mengupload...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" />
                          Upload Bukti
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={() => { setSelectedOrder(null); setProofFile(null) }}
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
