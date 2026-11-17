
import './App.css'
import { useEffect, useState } from 'react'
import { Routes, Route, Link, useParams } from 'react-router-dom'
import { supabase } from './supabase'
import { ubicaciones, departamentos } from './ubicaciones'

const WHATSAPP_NUMBER = '50258846380'

function crearSlug(tomo) {
  const texto = `${tomo.nombreSerie}-${tomo.nombreEditorial || 'sin-editorial'}-${tomo.titulo || `tomo-${tomo.numero}`}`
  return texto.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function normalizarTexto(texto) {
  return String(texto || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').trim()
}

function ordenarCatalogo(tomos) {
  return [...tomos].sort((a, b) => {
    const comparacion = String(a.nombreSerie || '').localeCompare(
      String(b.nombreSerie || ''), 'es', { sensitivity: 'base' }
    )
    if (comparacion !== 0) return comparacion
    const numeroA = Number(a.numero) || 0
    const numeroB = Number(b.numero) || 0
    if (numeroA !== numeroB) return numeroA - numeroB
    return String(a.titulo || '').localeCompare(
      String(b.titulo || ''), 'es', { sensitivity: 'base' }
    )
  })
}

function formatearFechaPedido(fecha) {
  if (!fecha) return 'Sin fecha registrada'
  const fechaValida = new Date(fecha)
  if (Number.isNaN(fechaValida.getTime())) return String(fecha)
  return fechaValida.toLocaleString('es-GT', {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

function App() {
  const [tomos, setTomos] = useState([])
  const [carrito, setCarrito] = useState([])
  const [carritoAbierto, setCarritoAbierto] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [checkoutAbierto, setCheckoutAbierto] = useState(false)
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteTelefono, setClienteTelefono] = useState('')
  const [clienteDepartamento, setClienteDepartamento] = useState('')
  const [clienteMunicipio, setClienteMunicipio] = useState('')
  const [clienteDireccion, setClienteDireccion] = useState('')
  const [procesandoPedido, setProcesandoPedido] = useState(false)
  const [errorPedido, setErrorPedido] = useState('')
  const [pedidoCreado, setPedidoCreado] = useState(null)
  const [pedidoWhatsAppUrl, setPedidoWhatsAppUrl] = useState('')
  const [pedidoComprobanteToken, setPedidoComprobanteToken] = useState('')
  const [errorCancelarPedido, setErrorCancelarPedido] = useState('')
  const [cancelandoPedido, setCancelandoPedido] = useState(false)
  const [pedidoCancelado, setPedidoCancelado] = useState(false)

  async function cargarCatalogo() {
    const [
      { data: tomosData, error: tomosError },
      { data: seriesData, error: seriesError },
      { data: editorialesData, error: editorialesError }
    ] = await Promise.all([
      supabase.from('tomos').select('*').order('id'),
      supabase.from('series').select('*').order('id'),
      supabase.from('editoriales').select('*').order('nombre')
    ])

    if (tomosError || seriesError || editorialesError) {
      setError('No pudimos cargar el catálogo.')
      console.error(tomosError || seriesError || editorialesError)
      setCargando(false)
      return
    }

    const catalogo = (tomosData || []).map(tomo => {
      const serie = (seriesData || []).find(
        item => String(item.id) === String(tomo.serie_id)
      )
      const editorial = (editorialesData || []).find(
        item => String(item.id) === String(tomo.editorial_id ?? serie?.editorial_id)
      )
      const tomoCompleto = {
        ...tomo,
        nombreSerie: serie?.Nombre || 'Manga',
        nombreEditorial: editorial?.nombre || ''
      }
      return { ...tomoCompleto, slug: crearSlug(tomoCompleto) }
    })

    setTomos(ordenarCatalogo(catalogo))
    setError('')
    setCargando(false)
  }

  useEffect(() => { cargarCatalogo() }, [])

  function abrirCarrito() {
    setCheckoutAbierto(false)
    setErrorPedido('')
    setCarritoAbierto(true)
  }

  function agregarAlCarrito(tomo, cantidad = 1) {
    setPedidoCreado(null)
    setPedidoWhatsAppUrl('')
    setErrorPedido('')
    setCarrito(actual => {
      const existente = actual.find(item => item.id === tomo.id)
      const cantidadActual = existente ? existente.cantidad : 0
      if (cantidadActual + cantidad > Number(tomo.stock)) {
        alert('No hay suficientes unidades disponibles.')
        return actual
      }
      if (existente) {
        return actual.map(item => item.id === tomo.id
          ? { ...item, cantidad: cantidadActual + cantidad } : item)
      }
      return [...actual, { ...tomo, cantidad }]
    })
  }

  function cambiarCantidad(id, cambio) {
    setCarrito(actual => actual.map(item => item.id === id
      ? { ...item, cantidad: Math.min(Number(item.stock), item.cantidad + cambio) }
      : item
    ).filter(item => item.cantidad > 0))
  }

  function quitarDelCarrito(id) {
    setCarrito(actual => actual.filter(item => item.id !== id))
  }

  function abrirCheckout() {
    setErrorPedido('')
    setCheckoutAbierto(true)
  }

  function volverAlCarrito() {
    if (procesandoPedido) return
    setCheckoutAbierto(false)
    setErrorPedido('')
  }

  function cerrarCarrito() {
    if (procesandoPedido) return
    setCheckoutAbierto(false)
    setCarritoAbierto(false)
  }

  async function realizarPedido(event) {
    event.preventDefault()
    if (procesandoPedido) return
    setErrorPedido('')

    if (!carrito.length) return setErrorPedido('Tu carrito está vacío.')
    if (!clienteNombre.trim()) return setErrorPedido('Escribe tu nombre completo.')
    if (!clienteTelefono.trim()) return setErrorPedido('Escribe tu número de teléfono.')
    if (!clienteDepartamento) return setErrorPedido('Selecciona tu departamento.')
    if (!clienteMunicipio) return setErrorPedido('Selecciona tu municipio.')
    if (!clienteDireccion.trim()) return setErrorPedido('Escribe tu dirección exacta.')

    setProcesandoPedido(true)

    try {
      const carritoPedido = carrito.map(item => ({ ...item }))
      const nombrePedido = clienteNombre.trim()
      const telefonoPedido = clienteTelefono.trim()
      const departamentoPedido = clienteDepartamento
      const municipioPedido = clienteMunicipio
      const direccionPedido = clienteDireccion.trim()
      const direccionCompleta =
        `Departamento: ${departamentoPedido}; Municipio: ${municipioPedido}; Dirección exacta: ${direccionPedido}`

      const { data, error } = await supabase.functions.invoke('crear-pedido', {
        body: {
          cliente_nombre: nombrePedido,
          cliente_telefono: telefonoPedido,
          direccion: direccionCompleta,
          items: carritoPedido.map(item => ({
            tomo_id: item.id,
            cantidad: item.cantidad
          }))
        }
      })

      if (error) {
        console.error('Error de Supabase:', error)
        let mensajeServidor = ''
        try {
          const respuesta = await error.context?.json()
          mensajeServidor = respuesta?.error || ''
        } catch {}
        throw new Error(mensajeServidor || 'No se pudo enviar el pedido. Inténtalo nuevamente.')
      }

      if (!data?.success || !data?.pedido?.pedido_id) {
        throw new Error(data?.error || 'No se pudo confirmar el pedido.')
      }

      const resumenTomos = carritoPedido.map(item => {
        const precio = Number(item.precio)
        const subtotal = precio * item.cantidad
        return `• ${item.nombreSerie} - Tomo ${item.numero}\n` +
          `${item.nombreEditorial ? `Editorial: ${item.nombreEditorial}\n` : ''}` +
          `${item.titulo ? `Título: ${item.titulo}\n` : ''}` +
          `Cantidad: ${item.cantidad}\n` +
          `Precio unitario: Q${precio.toFixed(2)}\n` +
          `Subtotal: Q${subtotal.toFixed(2)}`
      }).join('\n\n')

      const mensajeWhatsApp =
        `¡Hola! Quiero confirmar mi pedido de MangaToriiii 🐱\n\n` +
        `Número de pedido: #${data.pedido.pedido_id}\n\n` +
        `DATOS DE ENTREGA\nNombre: ${nombrePedido}\nTeléfono: ${telefonoPedido}\n` +
        `Departamento: ${departamentoPedido}\nMunicipio: ${municipioPedido}\n` +
        `Dirección exacta: ${direccionPedido}\n\n` +
        `TOMOS SELECCIONADOS\n${resumenTomos}\n\n` +
        `Total de productos: Q${Number(data.pedido.total).toFixed(2)}\n\n` +
        `Después de realizar el depósito o transferencia, enviaré la captura de mi comprobante por este mismo chat. ¡Gracias!`

      setPedidoWhatsAppUrl(
        `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(mensajeWhatsApp)}`
      )
      setPedidoCreado(data.pedido)
      setPedidoCancelado(false)
      setPedidoComprobanteToken(
        data.comprobante_token || data.pedido.comprobante_token || ''
      )
      setErrorCancelarPedido('')
      setCarrito([])
      setClienteNombre('')
      setClienteTelefono('')
      setClienteDepartamento('')
      setClienteMunicipio('')
      setClienteDireccion('')
      setCheckoutAbierto(false)
      await cargarCatalogo()
    } catch (err) {
      console.error('Error al realizar pedido:', err)
      setErrorPedido(err.message || 'Ocurrió un error al procesar tu pedido.')
    } finally {
      setProcesandoPedido(false)
    }
  }


  async function cancelarPedidoCliente() {
    if (!pedidoCreado?.pedido_id || !pedidoComprobanteToken) {
      setErrorCancelarPedido('No encontramos los datos necesarios para cancelar. Contacta con la tienda.')
      return
    }

    setCancelandoPedido(true)
    setErrorCancelarPedido('')

    try {
      const { data, error } = await supabase.functions.invoke('cancelar-pedido', {
        body: {
          pedido_id: pedidoCreado.pedido_id,
          comprobante_token: pedidoComprobanteToken
        }
      })

      if (error) {
        let mensaje = ''
        try {
          const respuesta = await error.context?.json()
          mensaje = respuesta?.error || ''
        } catch {}
        throw new Error(mensaje || 'No se pudo cancelar el pedido.')
      }

      if (!data?.success) {
        throw new Error(data?.error || 'No se pudo cancelar el pedido.')
      }

      setPedidoCancelado(true)
      setPedidoComprobanteToken('')
      await cargarCatalogo()
    } catch (err) {
      console.error('Error al cancelar pedido:', err)
      setErrorCancelarPedido(err.message || 'Ocurrió un error al cancelar el pedido.')
    } finally {
      setCancelandoPedido(false)
    }
  }


  const total = carrito.reduce((suma, item) =>
    suma + Number(item.precio) * item.cantidad, 0)
  const unidades = carrito.reduce((suma, item) => suma + item.cantidad, 0)

  return (
    <div className="store">
      <header className="header">
        <Link to="/" className="brand">
          <span className="brand-icon">🐱</span>
          <span>MangaToriiii</span>
        </Link>
        <nav>
          <Link to="/">Inicio</Link>
          <Link to="/#catalogo">Catálogo</Link>
          <button className="nav-cart" onClick={abrirCarrito}>Carrito</button>
          <Link to="/#como-comprar">Cómo comprar</Link>
        </nav>
        <button className="cart" onClick={abrirCarrito}>🛒 Carrito ({unidades})</button>
      </header>

      {carritoAbierto && (
        <div className="cart-overlay" onClick={cerrarCarrito}>
          <section className="cart-modal" onClick={event => event.stopPropagation()}>
            <div className="cart-modal-header">
              <div>
                <span className="eyebrow">TU SELECCIÓN</span>
                <h2>{pedidoCreado ? (pedidoCancelado ? 'Pedido cancelado' : 'Pedido registrado') : checkoutAbierto ? 'Datos de entrega' : 'Mi carrito 🛒'}</h2>
              </div>
              <button className="cart-close" onClick={cerrarCarrito} disabled={procesandoPedido} aria-label="Cerrar carrito">✕</button>
            </div>

            {pedidoCreado ? (
              pedidoCancelado ? (
                <div className="checkout-success checkout-cancelled">
                  <h2>¡Pedido cancelado!</h2>
                  <p style={{ fontSize: '18px', lineHeight: 1.8, textAlign: 'center', color: '#593b30', fontWeight: 600 }}>
                    ¡Se canceló tu compra! Pero te seguimos esperando. Cuando quieras volver, MangaToriiii tendrá sus puertas abiertas para ti. 💕
                  </p>
                  <button className="admin-secondary-button" style={{ width: '100%', marginTop: '12px' }}
                    onClick={() => { setPedidoCreado(null); setPedidoCancelado(false); setPedidoWhatsAppUrl(''); setCarritoAbierto(false); setCheckoutAbierto(false) }}>
                    Volver a la tienda
                  </button>
                </div>
              ) : (
                <div className="checkout-success">
                  <h2>¡Pedido registrado! 🐱</h2>
                  <p>Tu pedido se ha registrado correctamente en MangaToriiii.</p>
                  <div className="order-summary">
                    <p>Número de pedido: <strong> #{pedidoCreado.pedido_id}</strong></p>
                    <p>Total: <strong> Q{Number(pedidoCreado.total).toFixed(2)}</strong></p>
                    <p>Estado: <strong>Pendiente de pago</strong></p>
                  </div>
                  <p>El pago se realiza previamente mediante depósito o transferencia. Después de realizarlo, envíanos una captura del comprobante directamente por WhatsApp.</p>
                  <p>El envío se realiza por Cargo Expreso y se paga al recibir el paquete.</p>
                  {pedidoWhatsAppUrl ? (
                    <a className="add-button checkout-submit" href={pedidoWhatsAppUrl} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', textDecoration: 'none' }}>
                      Enviar pedido y comprobante por WhatsApp
                    </a>
                  ) : <p className="checkout-error">No se pudo preparar el enlace de WhatsApp. Puedes escribirnos al 50258846380.</p>}
                  <button
                    type="button"
                    className="admin-secondary-button"
                    style={{ width: '100%', marginTop: '10px', borderColor: '#a33b32', color: '#a33b32' }}
                    onClick={cancelarPedidoCliente}
                    disabled={cancelandoPedido || !pedidoComprobanteToken}
                  >
                    {cancelandoPedido ? 'Cancelando pedido...' : 'Cancelar pedido'}
                  </button>
                  {errorCancelarPedido && <p className="checkout-error">{errorCancelarPedido}</p>}
                  <button className="admin-secondary-button" style={{ width: '100%', marginTop: '12px' }}
                    onClick={() => { setPedidoCreado(null); setPedidoCancelado(false); setPedidoWhatsAppUrl(''); setCarritoAbierto(false); setCheckoutAbierto(false) }}>
                    Volver a la tienda
                  </button>
                </div>
              )
            ) : checkoutAbierto ? (
              <form className="checkout-form" onSubmit={realizarPedido}>
                <div className="checkout-intro">
                  <span className="checkout-kicker">CASI TERMINAMOS</span>
                  <h3>¡Prepara tu entrega! 🐱</h3>
                  <p>Completa tus datos para que podamos enviar tu pedido correctamente.</p>
                </div>
                <div className="checkout-field">
                  <label htmlFor="checkout-nombre">Nombre completo</label>
                  <input id="checkout-nombre" className="checkout-name-input" type="text" value={clienteNombre}
                    onChange={event => setClienteNombre(event.target.value)} maxLength="100"
                    placeholder="Tu nombre completo" autoComplete="name" required disabled={procesandoPedido} />
                </div>
                <div className="checkout-field">
                  <label htmlFor="checkout-telefono">Número de teléfono</label>
                  <input id="checkout-telefono" type="tel" value={clienteTelefono}
                    onChange={event => setClienteTelefono(event.target.value)} maxLength="20"
                    placeholder="Ej. 55551234" autoComplete="tel" required disabled={procesandoPedido} />
                </div>
                <div className="checkout-divider"><span>📍 Dirección de entrega</span></div>
                <div className="checkout-field">
                  <label htmlFor="checkout-departamento">Departamento</label>
                  <select id="checkout-departamento" value={clienteDepartamento}
                    onChange={event => { setClienteDepartamento(event.target.value); setClienteMunicipio('') }}
                    required disabled={procesandoPedido}>
                    <option value="">Selecciona tu departamento</option>
                    {departamentos.map(departamento => <option key={departamento} value={departamento}>{departamento}</option>)}
                  </select>
                </div>
                <div className="checkout-field">
                  <label htmlFor="checkout-municipio">Municipio</label>
                  <select id="checkout-municipio" value={clienteMunicipio}
                    onChange={event => setClienteMunicipio(event.target.value)} required
                    disabled={!clienteDepartamento || procesandoPedido}>
                    <option value="">{clienteDepartamento ? 'Selecciona tu municipio' : 'Primero selecciona un departamento'}</option>
                    {(ubicaciones[clienteDepartamento] || []).map(municipio => <option key={municipio} value={municipio}>{municipio}</option>)}
                  </select>
                </div>
                <div className="checkout-field">
                  <label htmlFor="checkout-direccion">Dirección exacta</label>
                  <textarea id="checkout-direccion" value={clienteDireccion}
                    onChange={event => setClienteDireccion(event.target.value)} maxLength="500" rows="4"
                    placeholder="Zona, colonia, calle, avenida, número de casa y referencias..."
                    autoComplete="street-address" required disabled={procesandoPedido} />
                </div>
                <div className="checkout-shipping">
                  <div className="checkout-shipping-icon">🚚</div>
                  <div><strong>Envío por Cargo Expreso</strong><p>El costo del envío se paga al recibir tu paquete.</p></div>
                </div>
                <div className="checkout-payment-note">
                  <strong>Forma de pago</strong>
                  <p>El pago de los mangas se realiza previamente mediante depósito o transferencia. El envío se paga por separado al recibirlo.</p>
                </div>
                <div className="checkout-total"><span>Total de tu compra</span><strong>Q{total.toFixed(2)}</strong></div>
                {errorPedido && <p className="checkout-error">{errorPedido}</p>}
                <div className="checkout-actions">
                  <button type="button" className="admin-secondary-button" onClick={volverAlCarrito} disabled={procesandoPedido}>Volver</button>
                  <button type="submit" className="add-button checkout-submit" disabled={procesandoPedido}>
                    {procesandoPedido ? 'Registrando pedido...' : 'Confirmar pedido'}
                  </button>
                </div>
              </form>
            ) : carrito.length === 0 ? (
              <p className="empty-cart">Tu carrito está vacío. ¡Explora nuestro catálogo!</p>
            ) : (
              <>
                <div className="cart-modal-items">
                  {carrito.map(item => (
                    <article className="modal-cart-item" key={item.id}>
                      <div className="modal-cart-item-main" style={{ display: 'flex', flex: '1 1 220px', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                        <div style={{ flex: '0 0 64px', width: '64px', height: '88px', overflow: 'hidden', borderRadius: '9px', background: '#eadfce', display: 'grid', placeItems: 'center' }}>
                          {item.imagen_url ? <img src={item.imagen_url} alt={`${item.nombreSerie} tomo ${item.numero}`}
                            style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: '26px' }}>📚</span>}
                        </div>
                        <div className="modal-cart-info" style={{ minWidth: 0 }}>
                          <strong>{item.nombreSerie}</strong>
                          <p>Tomo {item.numero}{item.titulo && normalizarTexto(item.titulo) !== normalizarTexto(item.nombreSerie) ? ` · ${item.titulo}` : ''}</p>
                          {item.nombreEditorial && <small>{item.nombreEditorial}</small>}
                          <span>Q{Number(item.precio).toFixed(2)} c/u</span>
                        </div>
                      </div>
                      <div className="quantity-controls">
                        <button type="button" onClick={() => cambiarCantidad(item.id, -1)}>−</button>
                        <strong>{item.cantidad}</strong>
                        <button type="button" onClick={() => cambiarCantidad(item.id, 1)} disabled={item.cantidad >= Number(item.stock)}>+</button>
                      </div>
                      <strong className="modal-item-price">Q{(Number(item.precio) * item.cantidad).toFixed(2)}</strong>
                      <button type="button" className="remove-button" onClick={() => quitarDelCarrito(item.id)}>Quitar</button>
                    </article>
                  ))}
                </div>
                <div className="modal-cart-total"><span>Total de tu compra</span><strong>Q{total.toFixed(2)}</strong></div>
                <p className="modal-cart-note">El pago se realiza previamente mediante depósito o transferencia. El envío se paga al recibirlo.</p>
                {errorPedido && <p className="checkout-error">{errorPedido}</p>}
                <button type="button" className="add-button checkout-submit" onClick={abrirCheckout}>Proseguir con la compra</button>
              </>
            )}
          </section>
        </div>
      )}

      <Routes>
        <Route path="/" element={<Inicio tomos={tomos} cargando={cargando} error={error} />} />
        <Route path="/manga/:slug" element={<Detalle tomos={tomos} cargando={cargando} agregarAlCarrito={agregarAlCarrito} abrirCarrito={abrirCarrito} />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/recuperar-contrasena" element={<RecuperarContrasena />} />
        <Route path="/actualizar-contrasena" element={<ActualizarContrasena />} />
        <Route path="*" element={<main className="not-found"><h2>¡Ups! No encontramos esta página.</h2><Link className="main-button" to="/">Volver al catálogo</Link></main>} />
      </Routes>
      <footer><strong>MangaToriiii 🐱</strong><p>Un mundo de historias en cada tomo.</p></footer>
    </div>
  )
}

function Inicio({ tomos, cargando, error }) {
  const [busqueda, setBusqueda] = useState('')
  const textoBusqueda = normalizarTexto(busqueda)
  const resultadosBusqueda = tomos.filter(tomo => {
    if (Number(tomo.stock) <= 0 || !textoBusqueda) return false
    return normalizarTexto(tomo.nombreSerie).includes(textoBusqueda) ||
      normalizarTexto(tomo.titulo).includes(textoBusqueda) ||
      normalizarTexto(tomo.numero).includes(textoBusqueda)
  })
  const catalogoOrdenado = ordenarCatalogo(tomos.filter(tomo => Number(tomo.stock) > 0))
  const mostrarResultados = busqueda.trim().length > 0
  const mangasMostrar = mostrarResultados ? ordenarCatalogo(resultadosBusqueda) : catalogoOrdenado

  return (
    <main>
      <section className="hero" id="inicio">
        <span className="eyebrow">TU RINCÓN MANGA</span>
        <h1>Historias que<br />merecen estar<br /><span>en tu colección.</span></h1>
        <p>Encuentra tus mangas favoritos y descubre nuevas historias en MangaToriiii.</p>
        <a className="main-button" href="#catalogo">Explorar catálogo →</a>
        <div className="hero-decoration">漫</div>
      </section>
      <section className="catalog" id="catalogo">
        <span className="eyebrow">DESCUBRE TU PRÓXIMA HISTORIA</span>
        <h2>Nuestro catálogo</h2>
        <div className="catalog-search">
          <label htmlFor="buscar-manga">Buscar un manga</label>
          <div className="search-input-wrapper">
            <span className="search-icon">⌕</span>
            <input id="buscar-manga" type="search" value={busqueda}
              onChange={event => setBusqueda(event.target.value)}
              placeholder="Buscar por nombre de serie o título..." autoComplete="off" />
            {busqueda && <button type="button" className="search-clear" onClick={() => setBusqueda('')} aria-label="Limpiar búsqueda">✕</button>}
          </div>
          <p className="search-help">Escribe el nombre de una serie para ver sus tomos disponibles.</p>
        </div>
        {cargando && <p>Cargando mangas...</p>}
        {error && <p>{error}</p>}
        {!cargando && !error && (
          <>
            {mostrarResultados && <div className="search-results-heading"><h3>Resultados de búsqueda</h3><span>{resultadosBusqueda.length} {resultadosBusqueda.length === 1 ? 'tomo disponible' : 'tomos disponibles'}</span></div>}
            {!mostrarResultados && <p className="catalog-order-note">Explora nuestras series en orden alfabético, de la A a la Z.</p>}
            {mangasMostrar.length === 0 ? (
              <div className="search-empty">
                {mostrarResultados ? <>
                  <span>🔎</span><h3>No encontramos ese manga</h3>
                  <p>No hay tomos disponibles que coincidan con «{busqueda}».</p>
                  <button className="search-reset-button" onClick={() => setBusqueda('')}>Ver todo el catálogo</button>
                </> : <>
                  <span>📚</span><h3>Por ahora no hay tomos disponibles</h3>
                  <p>Estamos preparando nuestro catálogo. Vuelve pronto para descubrir nuevas historias.</p>
                </>}
              </div>
            ) : (
              <div className="products">
                {mangasMostrar.map(tomo => (
                  <Link to={`/manga/${tomo.slug}`} className="product-card product-link" key={tomo.id}
                    aria-label={`${tomo.nombreSerie}, Tomo ${tomo.numero}. Disponible. Ver detalles.`}>
                    {tomo.imagen_url ? <img src={tomo.imagen_url} alt={tomo.titulo || tomo.nombreSerie} /> : <div className="product-placeholder">📚</div>}
                    <div className="product-info">
                      <span className="eyebrow">{tomo.nombreSerie}</span>
                      <h3>{tomo.titulo || `Tomo ${tomo.numero}`}</h3>
                      {tomo.nombreEditorial && <p className="product-publisher">{tomo.nombreEditorial}</p>}
                      <strong>Q{Number(tomo.precio).toFixed(2)}</strong>
                      <p>{tomo.stock} disponible(s)</p>
                      <span className="add-button product-view-button">Ver producto →</span>
                    </div>
                    <div className="product-mobile-info"><strong>Tomo {tomo.numero}</strong><span><span className="mobile-stock-dot"></span>Disponible</span></div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </section>
      <section className="how" id="como-comprar">
        <h2>¿Cómo comprar?</h2>
        <p>Explora nuestro catálogo, selecciona tus mangas y revisa tu carrito. El pago se realiza previamente mediante depósito o transferencia. El envío se realiza por Cargo Expreso y se paga al recibirlo.</p>
      </section>
    </main>
  )
}

function Detalle({ tomos, cargando, agregarAlCarrito, abrirCarrito }) {
  const { slug } = useParams()
  const [cantidad, setCantidad] = useState(1)
  const tomo = tomos.find(item => item.slug === slug)
  useEffect(() => { setCantidad(1) }, [slug])

  if (cargando) return <main className="detail-page"><p>Cargando producto...</p></main>
  if (!tomo) return <main className="not-found"><h2>No encontramos este manga.</h2><Link className="main-button" to="/">Volver al catálogo</Link></main>

  const disponible = Number(tomo.stock) > 0
  const precio = Number(tomo.precio)
  const totalProducto = precio * cantidad

  function comprarPorWhatsApp() {
    const mensaje = `¡Hola! Me interesa este manga:\n${tomo.nombreSerie} - Tomo ${tomo.numero}\nCantidad: ${cantidad}\nPrecio: Q${precio.toFixed(2)} c/u\nTotal: Q${totalProducto.toFixed(2)}\n¿Me pueden confirmar disponibilidad?`
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(mensaje)}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <main className="detail-page">
      <Link className="back-button" to="/"><span>←</span> Volver al catálogo</Link>
      <div className="product-detail">
        <div className="detail-image">{tomo.imagen_url ? <img src={tomo.imagen_url} alt={tomo.titulo || tomo.nombreSerie} /> : <div className="product-placeholder">📚</div>}</div>
        <div className="detail-info">
          <span className="eyebrow">{tomo.nombreSerie}</span>
          {tomo.nombreEditorial && <p className="product-publisher">{tomo.nombreEditorial}</p>}
          <h1>{tomo.titulo || `Tomo ${tomo.numero}`}</h1>
          <strong className="detail-price">Q{precio.toFixed(2)}</strong>
          <p className="detail-description">Descubre {tomo.nombreSerie} y disfruta de esta entrega de tu colección manga.</p>
          <p className={disponible ? 'stock-available' : 'stock-empty'}>{disponible ? `✓ ${tomo.stock} disponible(s)` : 'Actualmente agotado'}</p>
          {disponible && <>
            <div className="detail-quantity"><span>Cantidad:</span><div className="quantity-controls">
              <button onClick={() => setCantidad(actual => Math.max(1, actual - 1))} disabled={cantidad <= 1}>−</button>
              <strong>{cantidad}</strong>
              <button onClick={() => setCantidad(actual => Math.min(Number(tomo.stock), actual + 1))} disabled={cantidad >= Number(tomo.stock)}>+</button>
            </div></div>
            <p className="detail-subtotal">Subtotal: <strong>Q{totalProducto.toFixed(2)}</strong></p>
            <button className="add-button detail-add-button" onClick={() => { agregarAlCarrito(tomo, cantidad); abrirCarrito() }}>Añadir al carrito</button>
            <button className="whatsapp-button" onClick={comprarPorWhatsApp}><span>☏</span> Comprar por WhatsApp</button>
          </>}
          <p className="detail-payment-note">Pago mediante depósito o transferencia. Confirmaremos existencias y el total antes de coordinar el pago.</p>
        </div>
      </div>
      <section className="detail-description-section"><h2>Descripción</h2><p>{tomo.descripcion || `Añade ${tomo.titulo || `el tomo ${tomo.numero}`} de ${tomo.nombreSerie} a tu colección. Contáctanos si deseas más información.`}</p></section>
    </main>
  )
}

function Admin() {
  const [sesion, setSesion] = useState(null)
  const [comprobando, setComprobando] = useState(true)
  useEffect(() => {
    let activo = true
    async function revisarSesion() {
      const { data, error } = await supabase.auth.getSession()
      if (!activo) return
      if (error) console.error(error)
      setSesion(data?.session ?? null)
      setComprobando(false)
    }
    revisarSesion()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSesion(session)
      setComprobando(false)
    })
    return () => { activo = false; subscription.unsubscribe() }
  }, [])
  if (comprobando) return <main className="admin-page">Comprobando acceso...</main>
  if (!sesion) return <LoginAdmin />
  return <PanelAdmin sesion={sesion} />
}

function LoginAdmin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  async function iniciarSesion(event) {
    event.preventDefault()
    setError('')
    setCargando(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('No se pudo iniciar sesión. Revisa tus datos o permisos.')
    setCargando(false)
  }

  return (
    <main className="admin-page"><section className="admin-login">
      <span className="eyebrow">MANGATORIIII</span><h1>Panel de administración</h1><p>Inicia sesión para administrar la tienda.</p>
      <form onSubmit={iniciarSesion}>
        <label htmlFor="admin-email">Correo electrónico</label>
        <input id="admin-email" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required />
        <label htmlFor="admin-password">Contraseña</label>
        <input id="admin-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required />
        {error && <p className="admin-error">{error}</p>}
        <button type="submit" disabled={cargando}>{cargando ? 'Ingresando...' : 'Iniciar sesión'}</button>
      </form>
      <Link to="/recuperar-contrasena" className="admin-back-link">¿Olvidaste tu contraseña?</Link>
      <Link to="/" className="admin-back-link">Volver a la tienda</Link>
    </section></main>
  )
}

function RecuperarContrasena() {
  const [email, setEmail] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  async function enviarRecuperacion(event) {
    event.preventDefault()
    setMensaje('')
    setError('')
    setCargando(true)
    const redirectTo = `${window.location.origin}/actualizar-contrasena`
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    if (error) setError('No se pudo enviar el correo. Comprueba la dirección e inténtalo nuevamente.')
    else setMensaje('Si el correo está registrado, recibirás un enlace para cambiar tu contraseña.')
    setCargando(false)
  }

  return (
    <main className="admin-page"><section className="admin-login">
      <span className="eyebrow">MANGATORIIII</span><h1>Recuperar contraseña</h1><p>Escribe el correo asociado a tu cuenta de administración.</p>
      <form onSubmit={enviarRecuperacion}>
        <label htmlFor="recovery-email">Correo electrónico</label>
        <input id="recovery-email" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required />
        {error && <p className="admin-error">{error}</p>}{mensaje && <p className="admin-success">{mensaje}</p>}
        <button type="submit" disabled={cargando}>{cargando ? 'Enviando...' : 'Enviar enlace'}</button>
      </form>
      <Link to="/admin" className="admin-back-link">Volver al inicio de sesión</Link>
    </section></main>
  )
}

function ActualizarContrasena() {
  const [password, setPassword] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [sesionLista, setSesionLista] = useState(false)

  useEffect(() => {
    let activo = true
    async function comprobarEnlace() {
      const { data, error } = await supabase.auth.getSession()
      if (!activo) return
      if (error || !data.session) setError('El enlace no es válido o ha expirado. Solicita uno nuevo.')
      else setSesionLista(true)
    }
    comprobarEnlace()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!activo) return
      if (session) { setSesionLista(true); setError('') }
    })
    return () => { activo = false; subscription.unsubscribe() }
  }, [])

  async function guardarNuevaContrasena(event) {
    event.preventDefault()
    setError('')
    setMensaje('')
    if (password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.')
    if (password !== confirmacion) return setError('Las contraseñas no coinciden.')
    setCargando(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) setError('No se pudo actualizar la contraseña. Solicita otro enlace.')
    else { setMensaje('¡Contraseña actualizada! Ya puedes iniciar sesión.'); setPassword(''); setConfirmacion('') }
    setCargando(false)
  }

  return (
    <main className="admin-page"><section className="admin-login">
      <span className="eyebrow">MANGATORIIII</span><h1>Nueva contraseña</h1>
      {sesionLista ? <>
        <p>Escribe tu nueva contraseña para la cuenta de administración.</p>
        <form onSubmit={guardarNuevaContrasena}>
          <label htmlFor="new-password">Nueva contraseña</label>
          <input id="new-password" type="password" value={password} onChange={event => setPassword(event.target.value)} minLength="8" autoComplete="new-password" required />
          <label htmlFor="confirm-password">Confirmar contraseña</label>
          <input id="confirm-password" type="password" value={confirmacion} onChange={event => setConfirmacion(event.target.value)} minLength="8" autoComplete="new-password" required />
          {error && <p className="admin-error">{error}</p>}{mensaje && <p className="admin-success">{mensaje}</p>}
          <button type="submit" disabled={cargando}>{cargando ? 'Actualizando...' : 'Guardar contraseña'}</button>
        </form>
        {mensaje && <Link to="/admin" className="admin-back-link">Ir al inicio de sesión</Link>}
      </> : <><p>{error || 'Comprobando el enlace de recuperación...'}</p>{error && <Link to="/recuperar-contrasena" className="admin-back-link">Solicitar otro enlace</Link>}</>}
    </section></main>
  )
}

const FORMULARIO_VACIO = {
  serie_id: '', editorial_id: '', titulo: '', numero: '', precio: '', stock: '',
  descripcion: '', imagen_url: ''
}

const EDITORIAL_VACIA = { nombre: '', pais: '' }

function PanelAdmin({ sesion }) {
  const [series, setSeries] = useState([])
  const [tomos, setTomos] = useState([])
  const [editoriales, setEditoriales] = useState([])
  const [formulario, setFormulario] = useState(FORMULARIO_VACIO)
  const [nombreSerie, setNombreSerie] = useState('')
  const [editorialSerie, setEditorialSerie] = useState('')
  const [editandoSerieId, setEditandoSerieId] = useState(null)
  const [formEditorial, setFormEditorial] = useState(EDITORIAL_VACIA)
  const [editandoEditorialId, setEditandoEditorialId] = useState(null)
  const [editandoId, setEditandoId] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')
  const [archivo, setArchivo] = useState(null)
  const [busquedaInventario, setBusquedaInventario] = useState('')

  // Estados de gestión de pedidos
  const [pedidos, setPedidos] = useState([])
  const [pedidosArchivados, setPedidosArchivados] = useState([])
  const [pedidosItems, setPedidosItems] = useState([])
  const [cargandoPedidos, setCargandoPedidos] = useState(true)
  const [errorPedidos, setErrorPedidos] = useState('')
  const [mensajePedidos, setMensajePedidos] = useState('')
  const [guardandoPedidoId, setGuardandoPedidoId] = useState(null)
  const [eliminandoPedidoId, setEliminandoPedidoId] = useState(null)

  // Estados del historial desplegable y su buscador
  const [mostrarArchivados, setMostrarArchivados] = useState(false)
  const [busquedaArchivados, setBusquedaArchivados] = useState('')

  async function cargarDatos() {
    setCargando(true)
    setError('')
    const [
      { data: seriesData, error: errorSeries },
      { data: tomosData, error: errorTomos },
      { data: editorialesData, error: errorEditoriales }
    ] = await Promise.all([
      supabase.from('series').select('*').order('Nombre'),
      supabase.from('tomos').select('*').order('id', { ascending: false }),
      supabase.from('editoriales').select('*').order('nombre')
    ])

    if (errorSeries || errorTomos || errorEditoriales) {
      setError('No se pudieron cargar los datos. Comprueba las políticas RLS de series, tomos y editoriales.')
      console.error(errorSeries || errorTomos || errorEditoriales)
    } else {
      setSeries(seriesData || [])
      setTomos(tomosData || [])
      setEditoriales(editorialesData || [])
    }
    setCargando(false)
  }

  async function cargarPedidos() {
    setCargandoPedidos(true)
    setErrorPedidos('')
    setMensajePedidos('')

    const [
      { data: pedidosData, error: errorPedidosData },
      { data: itemsData, error: errorItemsData }
    ] = await Promise.all([
      supabase.from('pedidos').select('*').order('fecha', { ascending: false }),
      supabase.from('pedidos_items').select('*')
    ])

    if (errorPedidosData || errorItemsData) {
      console.error('Error al cargar pedidos:', errorPedidosData || errorItemsData)
      setErrorPedidos(
        'No se pudieron cargar los pedidos. Revisa las políticas RLS y los permisos de la API para pedidos y pedidos_items.'
      )
      setCargandoPedidos(false)
      return
    }

    const todos = pedidosData || []
    setPedidos(todos.filter(pedido => pedido.archivado !== true))
    setPedidosArchivados(todos.filter(pedido => pedido.archivado === true))
    setPedidosItems(itemsData || [])
    setCargandoPedidos(false)
  }

  useEffect(() => {
    cargarDatos()
    cargarPedidos()
  }, [])

  function cambiarCampo(event) {
    const { name, value } = event.target
    setFormulario(actual => ({ ...actual, [name]: value }))
  }

  function editarTomo(tomo) {
    setEditandoId(tomo.id)
    setFormulario({
      serie_id: String(tomo.serie_id ?? ''),
      editorial_id: String(tomo.editorial_id ?? ''),
      titulo: tomo.titulo ?? '',
      numero: tomo.numero ?? '',
      precio: tomo.precio ?? '',
      stock: tomo.stock ?? '',
      descripcion: tomo.descripcion ?? '',
      imagen_url: tomo.imagen_url ?? ''
    })
    setArchivo(null)
    setMensaje('')
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelarEdicion() {
    setEditandoId(null)
    setFormulario(FORMULARIO_VACIO)
    setArchivo(null)
    setMensaje('')
    setError('')
  }

  async function subirPortada() {
    if (!archivo) return formulario.imagen_url
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(archivo.type)) {
      throw new Error('La portada debe ser JPG, PNG o WEBP.')
    }
    if (archivo.size > 5 * 1024 * 1024) throw new Error('La imagen no puede superar los 5 MB.')
    const extension = archivo.name.split('.').pop().toLowerCase()
    const ruta = `tomos/${crypto.randomUUID()}.${extension}`
    const { error: errorSubida } = await supabase.storage.from('portadas').upload(ruta, archivo, {
      cacheControl: '3600', upsert: false, contentType: archivo.type
    })
    if (errorSubida) throw errorSubida
    const { data } = supabase.storage.from('portadas').getPublicUrl(ruta)
    return data.publicUrl
  }

  async function guardarTomo(event) {
    event.preventDefault()
    setGuardando(true)
    setMensaje('')
    setError('')
    try {
      if (!formulario.serie_id) throw new Error('Selecciona una serie.')
      const precio = Number(formulario.precio)
      const stock = Number(formulario.stock)
      const numero = Number(formulario.numero)
      if (!Number.isFinite(precio) || precio < 0) throw new Error('Escribe un precio válido.')
      if (!Number.isInteger(stock) || stock < 0) throw new Error('El stock debe ser un número entero igual o mayor a cero.')
      if (!Number.isInteger(numero) || numero < 1) throw new Error('Escribe un número de tomo válido.')
      const imagen_url = await subirPortada()
      const datos = {
        serie_id: formulario.serie_id,
        editorial_id: formulario.editorial_id || null,
        titulo: formulario.titulo.trim() || null,
        numero, precio, stock,
        descripcion: formulario.descripcion.trim(),
        imagen_url: imagen_url || null
      }
      const resultado = editandoId
        ? await supabase.from('tomos').update(datos).eq('id', editandoId)
        : await supabase.from('tomos').insert(datos)
      if (resultado.error) throw resultado.error
      setMensaje(editandoId ? 'Tomo actualizado correctamente.' : 'Tomo agregado correctamente.')
      setEditandoId(null)
      setFormulario(FORMULARIO_VACIO)
      setArchivo(null)
      await cargarDatos()
    } catch (err) {
      console.error(err)
      setError(err.message || 'No se pudo guardar el tomo.')
    } finally { setGuardando(false) }
  }

  async function guardarEditorial(event) {
    event.preventDefault()
    setError('')
    setMensaje('')
    const nombre = formEditorial.nombre.trim()
    const pais = formEditorial.pais.trim()
    if (!nombre) return setError('Escribe el nombre de la editorial.')
    setGuardando(true)
    try {
      const datos = { nombre, pais: pais || null }
      const resultado = editandoEditorialId
        ? await supabase.from('editoriales').update(datos).eq('id', editandoEditorialId)
        : await supabase.from('editoriales').insert(datos)
      if (resultado.error) throw resultado.error
      setMensaje(editandoEditorialId ? 'Editorial actualizada correctamente.' : 'Editorial agregada correctamente.')
      setFormEditorial(EDITORIAL_VACIA)
      setEditandoEditorialId(null)
      await cargarDatos()
    } catch (err) {
      console.error(err)
      setError(err.message || 'No se pudo guardar la editorial.')
    } finally { setGuardando(false) }
  }

  function editarEditorial(editorial) {
    setEditandoEditorialId(editorial.id)
    setFormEditorial({ nombre: editorial.nombre || '', pais: editorial.pais || '' })
    setMensaje('')
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelarEditorial() {
    setEditandoEditorialId(null)
    setFormEditorial(EDITORIAL_VACIA)
    setMensaje('')
    setError('')
  }

  async function eliminarEditorial(editorial) {
    const confirmado = window.confirm(`¿Eliminar la editorial "${editorial.nombre}"? Las series relacionadas quedarán sin editorial asignada.`)
    if (!confirmado) return
    setError('')
    setMensaje('')
    const { error } = await supabase.from('editoriales').delete().eq('id', editorial.id)
    if (error) {
      console.error(error)
      setError('No se pudo eliminar la editorial. Comprueba si tiene relaciones o permisos.')
    } else {
      if (String(editandoEditorialId) === String(editorial.id)) cancelarEditorial()
      setMensaje('Editorial eliminada correctamente.')
      await cargarDatos()
    }
  }

  async function guardarSerie(event) {
    event.preventDefault()
    setError('')
    setMensaje('')
    const nombre = nombreSerie.trim()
    if (!nombre) return setError('Escribe el nombre de la serie.')
    setGuardando(true)
    try {
      const datos = { Nombre: nombre, editorial_id: editorialSerie || null }
      const resultado = editandoSerieId
        ? await supabase.from('series').update(datos).eq('id', editandoSerieId)
        : await supabase.from('series').insert(datos)
      if (resultado.error) throw resultado.error
      setNombreSerie('')
      setEditorialSerie('')
      setEditandoSerieId(null)
      setMensaje(editandoSerieId ? 'Serie actualizada correctamente.' : 'Serie agregada correctamente.')
      await cargarDatos()
    } catch (err) {
      console.error(err)
      setError(err.message || 'No se pudo guardar la serie.')
    } finally { setGuardando(false) }
  }

  function editarSerie(serie) {
    setEditandoSerieId(serie.id)
    setNombreSerie(serie.Nombre || '')
    setEditorialSerie(serie.editorial_id ? String(serie.editorial_id) : '')
    setMensaje('')
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelarSerie() {
    setEditandoSerieId(null)
    setNombreSerie('')
    setEditorialSerie('')
  }

  async function eliminarTomo(tomo) {
    const confirmado = window.confirm(`¿Seguro que deseas eliminar "${tomo.titulo || `Tomo ${tomo.numero}`}"?`)
    if (!confirmado) return
    setError('')
    setMensaje('')
    const { error } = await supabase.from('tomos').delete().eq('id', tomo.id)
    if (error) {
      console.error(error)
      setError('No se pudo eliminar. Puede que este tomo esté relacionado con un pedido.')
    } else {
      setMensaje('Tomo eliminado correctamente.')
      if (editandoId === tomo.id) cancelarEdicion()
      await cargarDatos()
    }
  }

  async function eliminarSerie(serie) {
    const tieneTomos = tomos.some(tomo => String(tomo.serie_id) === String(serie.id))
    if (tieneTomos) return setError('No puedes eliminar una serie que todavía tiene tomos.')
    const confirmado = window.confirm(`¿Eliminar la serie "${serie.Nombre}"?`)
    if (!confirmado) return
    const { error } = await supabase.from('series').delete().eq('id', serie.id)
    if (error) {
      console.error(error)
      setError('No se pudo eliminar la serie.')
    } else {
      setMensaje('Serie eliminada correctamente.')
      await cargarDatos()
    }
  }

  function cambiarDatoPedido(pedidoId, campo, valor) {
    setPedidos(actual => actual.map(pedido =>
      String(pedido.id) === String(pedidoId)
        ? { ...pedido, [campo]: valor }
        : pedido
    ))

    setPedidosArchivados(actual => actual.map(pedido =>
      String(pedido.id) === String(pedidoId)
        ? { ...pedido, [campo]: valor }
        : pedido
    ))
  }

  async function guardarCambiosPedido(pedido) {
    setGuardandoPedidoId(pedido.id)
    setErrorPedidos('')
    setMensajePedidos('')

    const datos = {
      estado: pedido.estado || 'pendiente de pago',
      guia_envio: pedido.guia_envio?.trim() || null
    }

    const { data, error } = await supabase
      .from('pedidos')
      .update(datos)
      .eq('id', pedido.id)
      .select()
      .single()

    if (error) {
      console.error('Error al actualizar pedido:', error)
      setErrorPedidos(
        `No se pudieron guardar los cambios del pedido #${pedido.id}. Revisa los permisos de actualización de la tabla pedidos.`
      )
    } else {
      setPedidos(actual => actual.map(item =>
        String(item.id) === String(pedido.id) ? data : item
      ))
      setPedidosArchivados(actual => actual.map(item =>
        String(item.id) === String(pedido.id) ? data : item
      ))
      setMensajePedidos(`Pedido #${pedido.id} actualizado correctamente.`)
    }

    setGuardandoPedidoId(null)
  }

  async function archivarPedido(pedido) {
    if (pedido.estado !== 'entregado') {
      setErrorPedidos('Solo puedes archivar pedidos entregados.')
      return
    }

    const confirmado = window.confirm(
      `¿Archivar el pedido #${pedido.id}? Podrás consultarlo después en el historial.`
    )

    if (!confirmado) return

    setErrorPedidos('')
    setMensajePedidos('')
    setGuardandoPedidoId(pedido.id)

    const { data, error } = await supabase
      .from('pedidos')
      .update({
        estado: 'entregado',
        guia_envio: pedido.guia_envio?.trim() || null,
        archivado: true
      })
      .eq('id', pedido.id)
      .select()
      .single()

    if (error) {
      console.error('Error al archivar pedido:', error)
      setErrorPedidos(`No se pudo archivar el pedido #${pedido.id}. Comprueba los permisos de actualización.`)
    } else {
      setPedidos(actual =>
        actual.filter(item => String(item.id) !== String(pedido.id))
      )
      setPedidosArchivados(actual => [data, ...actual])
      setMensajePedidos(`Pedido #${pedido.id} archivado correctamente.`)
    }

    setGuardandoPedidoId(null)
  }

  async function restaurarPedido(pedido) {
    const confirmado = window.confirm(
      `¿Restaurar el pedido #${pedido.id} a los pedidos activos?`
    )

    if (!confirmado) return

    setErrorPedidos('')
    setMensajePedidos('')
    setGuardandoPedidoId(pedido.id)

    const { data, error } = await supabase
      .from('pedidos')
      .update({ archivado: false })
      .eq('id', pedido.id)
      .select()
      .single()

    if (error) {
      console.error('Error al restaurar pedido:', error)
      setErrorPedidos(`No se pudo restaurar el pedido #${pedido.id}. Comprueba los permisos de actualización.`)
    } else {
      setPedidosArchivados(actual =>
        actual.filter(item => String(item.id) !== String(pedido.id))
      )
      setPedidos(actual => [data, ...actual])
      setMensajePedidos(`Pedido #${pedido.id} restaurado correctamente.`)
    }

    setGuardandoPedidoId(null)
  }


  async function eliminarPedidoArchivado(pedido) {
    if (pedido.archivado !== true) {
      setErrorPedidos('Solo puedes eliminar pedidos que estén archivados.')
      return
    }

    const confirmado = window.confirm(
      `¿Eliminar DEFINITIVAMENTE el pedido #${pedido.id}? Se borrarán también sus artículos. Esta acción no se puede deshacer.`
    )
    if (!confirmado) return

    setErrorPedidos('')
    setMensajePedidos('')
    setEliminandoPedidoId(pedido.id)

    try {
      const { data, error } = await supabase.functions.invoke(
        'eliminar-pedido-archivado',
        { body: { pedido_id: pedido.id } }
      )

      if (error) {
        let mensaje = ''
        try {
          const respuesta = await error.context?.json()
          mensaje = respuesta?.error || ''
        } catch {}
        throw new Error(mensaje || 'No se pudo eliminar el pedido.')
      }

      if (!data?.success) {
        throw new Error(data?.error || 'No se pudo eliminar el pedido.')
      }

      setPedidosArchivados(actual =>
        actual.filter(item => String(item.id) !== String(pedido.id))
      )
      setPedidosItems(actual =>
        actual.filter(item => String(item.pedido_id) !== String(pedido.id))
      )
      setMensajePedidos(`Pedido #${pedido.id} eliminado definitivamente.`)
    } catch (err) {
      console.error('Error al eliminar pedido archivado:', err)
      setErrorPedidos(err.message || 'Ocurrió un error al eliminar el pedido.')
    } finally {
      setEliminandoPedidoId(null)
    }
  }

  function obtenerDetallePedido(item) {
    const tomo = tomos.find(t => String(t.id) === String(item.tomo_id))
    const serie = tomo
      ? series.find(s => String(s.id) === String(tomo.serie_id))
      : null
    const editorialId = tomo?.editorial_id ?? serie?.editorial_id
    const editorial = editoriales.find(e => String(e.id) === String(editorialId))

    return {
      tomo,
      serie,
      editorial,
      nombreSerie: serie?.Nombre || 'Serie no disponible',
      numero: tomo?.numero,
      titulo: tomo?.titulo,
      nombreEditorial: editorial?.nombre || 'Sin editorial',
      precio: Number(item.precio_unitario || 0),
      cantidad: Number(item.cantidad || 0)
    }
  }


  async function cerrarSesion() {
    const { error } = await supabase.auth.signOut()
    if (error) setError('No se pudo cerrar la sesión.')
  }

  // Inventario ordenado por serie (A-Z) y número de tomo (menor a mayor).
  const inventarioFiltrado = [...tomos]
    .map(tomo => ({
      ...tomo,
      _serieNombre: series.find(item => String(item.id) === String(tomo.serie_id))?.Nombre || 'Sin serie'
    }))
    .filter(tomo => {
      const texto = normalizarTexto(busquedaInventario)
      if (!texto) return true
      return (
        normalizarTexto(tomo._serieNombre).includes(texto) ||
        normalizarTexto(tomo.numero).includes(texto) ||
        normalizarTexto(tomo.titulo).includes(texto)
      )
    })
    .sort((a, b) => {
      const porSerie = String(a._serieNombre).localeCompare(
        String(b._serieNombre), 'es', { sensitivity: 'base' }
      )
      if (porSerie !== 0) return porSerie
      const numeroA = Number(a.numero) || 0
      const numeroB = Number(b.numero) || 0
      if (numeroA !== numeroB) return numeroA - numeroB
      return String(a.titulo || '').localeCompare(
        String(b.titulo || ''), 'es', { sensitivity: 'base' }
      )
    })

  // Pedidos archivados filtrados por número, guía, nombre o teléfono.
  const pedidosArchivadosFiltrados = [...pedidosArchivados]
    .filter(pedido => {
      const texto = normalizarTexto(busquedaArchivados)
      if (!texto) return true

      const numeroPedido = normalizarTexto(pedido.id)
      const guia = normalizarTexto(pedido.guia_envio)
      const nombre = normalizarTexto(pedido.cliente_nombre)
      const telefono = normalizarTexto(pedido.cliente_telefono)

      return (
        numeroPedido.includes(texto) ||
        guia.includes(texto) ||
        nombre.includes(texto) ||
        telefono.includes(texto) ||
        `#${numeroPedido}`.includes(texto)
      )
    })
    .sort((a, b) => {
      const fechaA = new Date(a.fecha || 0).getTime()
      const fechaB = new Date(b.fecha || 0).getTime()
      return fechaB - fechaA
    })

  return (
    <main className="admin-page">
      <div className="admin-dashboard">
        <div className="admin-topbar">
          <div>
            <span className="eyebrow">MANGATORIIII</span>
            <h1>Administración 🐱</h1>
            <p>Sesión: {sesion.user.email}</p>
          </div>
          <div className="admin-top-actions">
            <Link to="/" className="admin-secondary-button">Ver tienda</Link>
            <button type="button" onClick={cerrarSesion}>Cerrar sesión</button>
          </div>
        </div>

        {mensaje && <p className="admin-success">{mensaje}</p>}
        {error && <p className="admin-error">{error}</p>}

        {/* PEDIDOS ACTIVOS */}
        <section className="admin-section" id="gestion-pedidos">
          <div className="admin-list-heading">
            <div>
              <h2>Pedidos activos 📦</h2>
              <p>Gestiona las compras que todavía están en proceso.</p>
            </div>
            <button
              type="button"
              className="admin-secondary-button"
              onClick={cargarPedidos}
              disabled={cargandoPedidos}
            >
              {cargandoPedidos ? 'Actualizando...' : 'Actualizar pedidos'}
            </button>
          </div>

          {mensajePedidos && <p className="admin-success">{mensajePedidos}</p>}
          {errorPedidos && <p className="admin-error">{errorPedidos}</p>}

          {cargandoPedidos ? (
            <p>Cargando pedidos...</p>
          ) : pedidos.length === 0 ? (
            <p>No tienes pedidos activos. ¡Los nuevos pedidos aparecerán aquí!</p>
          ) : (
            <div style={{ display: 'grid', gap: '18px' }}>
              {pedidos.map(pedido => {
                const articulos = pedidosItems.filter(
                  item => String(item.pedido_id) === String(pedido.id)
                )
                const estadoActual = pedido.estado || 'pendiente de pago'

                return (
                  <article
                    key={pedido.id}
                    style={{
                      border: '1px solid #dfd3c2',
                      borderRadius: '14px',
                      padding: '18px',
                      background: '#fffdf9',
                      display: 'grid',
                      gap: '14px'
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '10px'
                    }}>
                      <div>
                        <h3 style={{ margin: 0 }}>Pedido #{pedido.id}</h3>
                        <small style={{ color: '#78685b' }}>
                          {formatearFechaPedido(pedido.fecha)}
                        </small>
                      </div>
                      <strong style={{
                        background: '#f1e8dc',
                        color: '#593b30',
                        padding: '7px 11px',
                        borderRadius: '20px',
                        fontSize: '13px'
                      }}>
                        {estadoActual}
                      </strong>
                    </div>

                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                      gap: '12px'
                    }}>
                      <div>
                        <strong>Cliente</strong>
                        <p style={{ margin: '5px 0' }}>{pedido.cliente_nombre || 'Sin nombre'}</p>
                      </div>
                      <div>
                        <strong>Teléfono</strong>
                        <p style={{ margin: '5px 0' }}>{pedido.cliente_telefono || 'Sin teléfono'}</p>
                      </div>
                      <div>
                        <strong>Dirección de entrega</strong>
                        <p style={{ margin: '5px 0', whiteSpace: 'pre-wrap' }}>
                          {pedido.direccion || 'Sin dirección registrada'}
                        </p>
                      </div>
                    </div>

                    <div>
                      <strong>Tomos del pedido</strong>
                      {articulos.length === 0 ? (
                        <p>No se encontraron artículos asociados a este pedido.</p>
                      ) : (
                        <div style={{ overflowX: 'auto', marginTop: '8px' }}>
                          <table className="admin-table">
                            <thead>
                              <tr>
                                <th>Serie</th>
                                <th>Tomo</th>
                                <th>Editorial</th>
                                <th>Cantidad</th>
                                <th>Precio</th>
                                <th>Subtotal</th>
                              </tr>
                            </thead>
                            <tbody>
                              {articulos.map(item => {
                                const detalle = obtenerDetallePedido(item)
                                return (
                                  <tr key={item.id}>
                                    <td>{detalle.nombreSerie}</td>
                                    <td>{detalle.titulo || `Tomo ${detalle.numero ?? '—'}`}</td>
                                    <td>{detalle.nombreEditorial}</td>
                                    <td>{detalle.cantidad}</td>
                                    <td>Q{detalle.precio.toFixed(2)}</td>
                                    <td>Q{(detalle.precio * detalle.cantidad).toFixed(2)}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px'
                    }}>
                      <strong style={{ fontSize: '18px' }}>
                        Total: Q{Number(pedido.total || 0).toFixed(2)}
                      </strong>

                    </div>

                    <div style={{
                      borderTop: '1px solid #e8dfd3',
                      paddingTop: '14px',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                      gap: '12px'
                    }}>
                      <div className="admin-form">
                        <label htmlFor={`estado-pedido-${pedido.id}`}>Estado del pedido</label>
                        <select
                          id={`estado-pedido-${pedido.id}`}
                          value={estadoActual}
                          onChange={event =>
                            cambiarDatoPedido(pedido.id, 'estado', event.target.value)
                          }
                        >
                          <option value="pendiente de pago">Pendiente de pago</option>
                          <option value="pagado">Pagado</option>
                          <option value="enviado">Enviado</option>
                          <option value="entregado">Entregado</option>
                        </select>
                      </div>

                      <div className="admin-form">
                        <label htmlFor={`guia-pedido-${pedido.id}`}>Guía de Cargo Expreso</label>
                        <input
                          id={`guia-pedido-${pedido.id}`}
                          type="text"
                          value={pedido.guia_envio || ''}
                          onChange={event =>
                            cambiarDatoPedido(pedido.id, 'guia_envio', event.target.value)
                          }
                          placeholder="Escribe el número de guía"
                        />
                      </div>
                    </div>

                    {pedido.guia_envio && (
                      <p style={{ margin: 0 }}>
                        <strong>Guía guardada:</strong> {pedido.guia_envio}
                      </p>
                    )}

                    <div className="admin-form-actions">
                      <button
                        type="button"
                        onClick={() => guardarCambiosPedido(pedido)}
                        disabled={guardandoPedidoId === pedido.id}
                      >
                        {guardandoPedidoId === pedido.id ? 'Guardando...' : 'Guardar cambios del pedido'}
                      </button>

                      {estadoActual === 'entregado' && (
                        <button
                          type="button"
                          className="admin-secondary-button"
                          onClick={() => archivarPedido(pedido)}
                          disabled={guardandoPedidoId === pedido.id}
                        >
                          {guardandoPedidoId === pedido.id ? 'Procesando...' : 'Archivar pedido'}
                        </button>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        {/* HISTORIAL DESPLEGABLE DE ENVÍOS */}
        <section className="admin-section" id="historial-pedidos">
          <div className="admin-list-heading">
            <div>
              <h2>Historial de envíos 📁</h2>
              <p>Busca y consulta los pedidos entregados que has archivado.</p>
            </div>
            <strong>{pedidosArchivados.length} archivado(s)</strong>
          </div>

          <button
            type="button"
            className="admin-secondary-button"
            onClick={() => {
              setMostrarArchivados(actual => !actual)
              setBusquedaArchivados('')
            }}
            style={{ width: '100%', marginBottom: '15px' }}
          >
            {mostrarArchivados ? 'Ocultar envíos archivados ▲' : '📁 Archivar envíos ▼'}
          </button>

          {mostrarArchivados && (
            <div style={{ display: 'grid', gap: '18px' }}>

              {/* BUSCADOR DEL HISTORIAL */}
              <div className="admin-form">
                <label htmlFor="buscar-pedido-archivado">
                  Buscar pedido
                </label>

                <input
                  id="buscar-pedido-archivado"
                  type="search"
                  value={busquedaArchivados}
                  onChange={event => setBusquedaArchivados(event.target.value)}
                  placeholder="Número de pedido, guía, nombre o teléfono..."
                  autoComplete="off"
                />

                <small style={{ color: '#78685b' }}>
                  Puedes buscar usando cualquiera de esos datos.
                </small>

                {busquedaArchivados && (
                  <button
                    type="button"
                    className="admin-secondary-button"
                    onClick={() => setBusquedaArchivados('')}
                  >
                    Limpiar búsqueda
                  </button>
                )}
              </div>

              {pedidosArchivados.length === 0 ? (
                <p>Todavía no hay pedidos archivados.</p>
              ) : pedidosArchivadosFiltrados.length === 0 ? (
                <div className="search-empty">
                  <span>🔎</span>
                  <h3>No encontramos ese pedido</h3>
                  <p>
                    No hay pedidos archivados que coincidan con «{busquedaArchivados}».
                  </p>
                  <button
                    type="button"
                    className="search-reset-button"
                    onClick={() => setBusquedaArchivados('')}
                  >
                    Ver todos los pedidos
                  </button>
                </div>
              ) : (
                <>
                  <p>
                    {pedidosArchivadosFiltrados.length}{' '}
                    {pedidosArchivadosFiltrados.length === 1
                      ? 'pedido encontrado'
                      : 'pedidos encontrados'}
                  </p>

                  {pedidosArchivadosFiltrados.map(pedido => {
                    const articulos = pedidosItems.filter(
                      item => String(item.pedido_id) === String(pedido.id)
                    )

                    return (
                      <article
                        key={pedido.id}
                        style={{
                          border: '1px solid #dfd3c2',
                          borderRadius: '14px',
                          padding: '18px',
                          background: '#f8f3eb',
                          display: 'grid',
                          gap: '12px'
                        }}
                      >
                        <div style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '10px'
                        }}>
                          <div>
                            <h3 style={{ margin: 0 }}>Pedido #{pedido.id}</h3>
                            <small>{formatearFechaPedido(pedido.fecha)}</small>
                          </div>
                          <strong>📁 Archivado · Entregado</strong>
                        </div>

                        <div>
                          <strong>Cliente:</strong>
                          <p style={{ margin: '5px 0' }}>
                            {pedido.cliente_nombre || 'Sin nombre'}
                          </p>
                        </div>

                        <div>
                          <strong>Teléfono:</strong>
                          <p style={{ margin: '5px 0' }}>
                            {pedido.cliente_telefono || 'Sin teléfono'}
                          </p>
                        </div>

                        <div>
                          <strong>Dirección:</strong>
                          <p style={{ whiteSpace: 'pre-wrap' }}>
                            {pedido.direccion || 'Sin dirección registrada'}
                          </p>
                        </div>

                        <div>
                          <strong>Tomos del pedido</strong>

                          {articulos.length === 0 ? (
                            <p>No se encontraron artículos asociados.</p>
                          ) : (
                            <div style={{ overflowX: 'auto', marginTop: '8px' }}>
                              <table className="admin-table">
                                <thead>
                                  <tr>
                                    <th>Serie</th>
                                    <th>Tomo</th>
                                    <th>Editorial</th>
                                    <th>Cantidad</th>
                                    <th>Precio</th>
                                    <th>Subtotal</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {articulos.map(item => {
                                    const detalle = obtenerDetallePedido(item)

                                    return (
                                      <tr key={item.id}>
                                        <td>{detalle.nombreSerie}</td>
                                        <td>
                                          {detalle.titulo || `Tomo ${detalle.numero ?? '—'}`}
                                        </td>
                                        <td>{detalle.nombreEditorial}</td>
                                        <td>{detalle.cantidad}</td>
                                        <td>Q{detalle.precio.toFixed(2)}</td>
                                        <td>
                                          Q{(detalle.precio * detalle.cantidad).toFixed(2)}
                                        </td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>

                        <strong style={{ fontSize: '18px' }}>
                          Total: Q{Number(pedido.total || 0).toFixed(2)}
                        </strong>

                        {pedido.guia_envio && (
                          <p style={{ margin: 0 }}>
                            <strong>Guía de envío:</strong> {pedido.guia_envio}
                          </p>
                        )}


                        <div className="admin-form-actions">
                          <button
                            type="button"
                            className="admin-secondary-button"
                            onClick={() => restaurarPedido(pedido)}
                            disabled={guardandoPedidoId === pedido.id}
                          >
                            {guardandoPedidoId === pedido.id
                              ? 'Restaurando...'
                              : 'Restaurar pedido'}
                          </button>
                          <button
                            type="button"
                            className="admin-secondary-button"
                            style={{ borderColor: '#a33b32', color: '#a33b32' }}
                            onClick={() => eliminarPedidoArchivado(pedido)}
                            disabled={eliminandoPedidoId === pedido.id || guardandoPedidoId === pedido.id}
                          >
                            {eliminandoPedidoId === pedido.id
                              ? 'Eliminando...'
                              : 'Eliminar definitivamente'}
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </>
              )}
            </div>
          )}
        </section>

        {/* EDITORIALES */}
        <section className="admin-section">
          <h2>{editandoEditorialId ? 'Editar editorial' : 'Editoriales'}</h2>
          <p>Registra las editoriales que distribuyen los mangas de tu tienda.</p>
          <form className="admin-form" onSubmit={guardarEditorial}>
            <label htmlFor="editorial-nombre">Nombre de la editorial</label>
            <input id="editorial-nombre" value={formEditorial.nombre}
              onChange={event => setFormEditorial(actual => ({ ...actual, nombre: event.target.value }))}
              placeholder="Ej. Ivrea" required />
            <label htmlFor="editorial-pais">País (opcional)</label>
            <input id="editorial-pais" value={formEditorial.pais}
              onChange={event => setFormEditorial(actual => ({ ...actual, pais: event.target.value }))}
              placeholder="Ej. Argentina" />
            <div className="admin-form-actions">
              <button type="submit" disabled={guardando}>{guardando ? 'Guardando...' : editandoEditorialId ? 'Guardar cambios' : 'Agregar editorial'}</button>
              {editandoEditorialId && <button type="button" className="admin-secondary-button" onClick={cancelarEditorial}>Cancelar</button>}
            </div>
          </form>

          <div className="admin-series-list">
            {editoriales.length === 0 ? <p>Todavía no hay editoriales registradas.</p> : editoriales.map(editorial => (
              <div className="admin-series-item" key={editorial.id}>
                <span><strong>{editorial.nombre}</strong>{editorial.pais ? ` · ${editorial.pais}` : ''}</span>
                <div className="admin-row-actions">
                  <button type="button" onClick={() => editarEditorial(editorial)}>Editar</button>
                  <button type="button" className="admin-delete-button" onClick={() => eliminarEditorial(editorial)}>Eliminar</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* AGREGAR O EDITAR TOMOS */}
        <section className="admin-section">
          <h2>{editandoId ? 'Editar tomo' : 'Agregar un tomo'}</h2>
          {series.length === 0 ? <p>Primero debes crear una serie.</p> : (
            <form className="admin-form" onSubmit={guardarTomo}>
              <label htmlFor="serie_id">Serie</label>
              <select id="serie_id" name="serie_id" value={formulario.serie_id} onChange={cambiarCampo} required>
                <option value="">Selecciona una serie</option>
                {series.map(serie => <option key={serie.id} value={serie.id}>{serie.Nombre}</option>)}
              </select>
              <label htmlFor="editorial_id">Editorial de esta edición</label>
              <select id="editorial_id" name="editorial_id" value={formulario.editorial_id} onChange={cambiarCampo}>
                <option value="">Usar editorial de la serie / Sin editorial</option>
                {editoriales.map(editorial => <option key={editorial.id} value={editorial.id}>{editorial.nombre}{editorial.pais ? ` · ${editorial.pais}` : ''}</option>)}
              </select>
              <label htmlFor="titulo">Título del tomo (opcional)</label>
              <input id="titulo" name="titulo" value={formulario.titulo} onChange={cambiarCampo} placeholder="Ej. Blue Lock" />
              <label htmlFor="numero">Número de tomo</label>
              <input id="numero" name="numero" type="number" min="1" step="1" value={formulario.numero} onChange={cambiarCampo} required />
              <label htmlFor="precio">Precio en quetzales</label>
              <input id="precio" name="precio" type="number" min="0" step="0.01" value={formulario.precio} onChange={cambiarCampo} required />
              <label htmlFor="stock">Existencias</label>
              <input id="stock" name="stock" type="number" min="0" step="1" value={formulario.stock} onChange={cambiarCampo} required />
              <label htmlFor="descripcion">Descripción</label>
              <textarea id="descripcion" name="descripcion" rows="5" value={formulario.descripcion} onChange={cambiarCampo} placeholder="Escribe aquí la descripción del tomo..." />
              <label htmlFor="portada">Portada (JPG, PNG o WEBP; máximo 5 MB)</label>
              <input
                id="portada"
                type="file"
                accept="image/*"
                onChange={event => setArchivo(event.target.files?.[0] || null)}
              />
              <small>También puedes seleccionar la imagen desde la galería de tu teléfono.</small>
              {formulario.imagen_url && !archivo && <div className="admin-current-cover"><p>Portada actual:</p><img src={formulario.imagen_url} alt="Portada actual" /></div>}
              {archivo && <p>Imagen seleccionada: {archivo.name}</p>}
              <div className="admin-form-actions">
                <button type="submit" disabled={guardando}>{guardando ? 'Guardando...' : editandoId ? 'Guardar cambios' : 'Agregar tomo'}</button>
                {editandoId && <button type="button" className="admin-secondary-button" onClick={cancelarEdicion}>Cancelar</button>}
              </div>
            </form>
          )}
        </section>

        {/* SERIES */}
        <section className="admin-section">
          <h2>{editandoSerieId ? 'Editar serie' : 'Agregar una serie'}</h2>
          <form className="admin-form" onSubmit={guardarSerie}>
            <label htmlFor="nombre-serie">Nombre de la serie</label>
            <input id="nombre-serie" type="text" value={nombreSerie} onChange={event => setNombreSerie(event.target.value)} placeholder="Ej. Blue Lock" required />
            <label htmlFor="editorial-serie">Editorial</label>
            <select id="editorial-serie" value={editorialSerie} onChange={event => setEditorialSerie(event.target.value)}>
              <option value="">Sin editorial asignada</option>
              {editoriales.map(editorial => <option key={editorial.id} value={editorial.id}>{editorial.nombre}{editorial.pais ? ` · ${editorial.pais}` : ''}</option>)}
            </select>
            {editoriales.length === 0 && <p>Primero puedes registrar editoriales en la sección Editoriales.</p>}
            <div className="admin-form-actions">
              <button type="submit" disabled={guardando}>{guardando ? 'Guardando...' : editandoSerieId ? 'Guardar cambios' : 'Agregar serie'}</button>
              {editandoSerieId && <button type="button" className="admin-secondary-button" onClick={cancelarSerie}>Cancelar</button>}
            </div>
          </form>
          <div className="admin-series-list">
            {series.map(serie => {
              const editorial = editoriales.find(item => String(item.id) === String(serie.editorial_id))
              return (
                <div className="admin-series-item" key={serie.id}>
                  <span>{serie.Nombre}{editorial ? ` · ${editorial.nombre}` : ' · Sin editorial'}</span>
                  <div className="admin-row-actions">
                    <button type="button" onClick={() => editarSerie(serie)}>Editar</button>
                    <button type="button" className="admin-delete-button" onClick={() => eliminarSerie(serie)}>Eliminar</button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* INVENTARIO */}
        <section className="admin-section">
          <div className="admin-list-heading">
            <h2>Inventario de tomos</h2>
            <button type="button" className="admin-secondary-button" onClick={cargarDatos}>Actualizar</button>
          </div>
          <div style={{ position: 'relative', margin: '12px 0 18px' }}>
            <label htmlFor="buscar-inventario" style={{ display: 'block', marginBottom: '7px', fontWeight: 600 }}>Buscar serie o número de tomo</label>
            <div style={{ position: 'relative' }}>
              <span aria-hidden="true" style={{ position: 'absolute', left: '13px', top: '50%', transform: 'translateY(-50%)', fontSize: '18px' }}>🔎</span>
              <input
                id="buscar-inventario"
                type="search"
                value={busquedaInventario}
                onChange={event => setBusquedaInventario(event.target.value)}
                placeholder="Ej. Blue Lock o 8"
                style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px 12px 42px', border: '1px solid #dfd3c2', borderRadius: '12px', background: '#fffdf9' }}
              />
            </div>
            <small style={{ display: 'block', marginTop: '7px', color: '#78685b' }}>Series ordenadas de la A a la Z y tomos del 1 al 100000 en orden numérico.</small>
          </div>
          {cargando ? <p>Cargando inventario...</p> : tomos.length === 0 ? <p>Todavía no hay tomos registrados.</p> : inventarioFiltrado.length === 0 ? <p>No encontramos tomos que coincidan con tu búsqueda.</p> : (
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead><tr><th>Tomo</th><th>Serie</th><th>Editorial</th><th>Precio</th><th>Stock</th><th>Acciones</th></tr></thead>
                <tbody>
                  {inventarioFiltrado.map(tomo => {
                    const serie = series.find(item => String(item.id) === String(tomo.serie_id))
                    const editorial = editoriales.find(item => String(item.id) === String(tomo.editorial_id ?? serie?.editorial_id))
                    return <tr key={tomo.id}>
                      <td>{tomo.titulo || `Tomo ${tomo.numero}`}</td>
                      <td>{serie?.Nombre || 'Sin serie'}</td>
                      <td>{editorial?.nombre || 'Sin editorial'}</td>
                      <td>Q{Number(tomo.precio).toFixed(2)}</td>
                      <td>{tomo.stock}</td>
                      <td><div className="admin-row-actions">
                        <button type="button" onClick={() => editarTomo(tomo)}>Editar</button>
                        <button type="button" className="admin-delete-button" onClick={() => eliminarTomo(tomo)}>Eliminar</button>
                      </div></td>
                    </tr>
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

export default App
