package co.sigpar.app.printing

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.net.Uri
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import androidx.core.content.FileProvider
import androidx.core.net.toUri
import co.sigpar.app.data.MovimientoDetalle
import java.io.File
import java.io.FileOutputStream

/** Recibo en PDF (ancho de tirilla de 80 mm) para compartir por WhatsApp/correo o imprimir por WiFi. */
object ReciboPdf {

    fun crear(ctx: Context, d: MovimientoDetalle): File {
        val columnas = 36
        val lineas = Recibo.lineas(d, columnas)
        val ancho = 226 // 80 mm a 72 puntos por pulgada
        val normal = Paint().apply { typeface = Typeface.MONOSPACE; textSize = 9f; isAntiAlias = true }
        val negrita = Paint(normal).apply { typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD) }
        val grande = Paint(negrita).apply { textSize = 13f }
        val alto = 30 + lineas.sumOf { if (it.grande) 18 else 12 } + 20

        val doc = PdfDocument()
        val pagina = doc.startPage(PdfDocument.PageInfo.Builder(ancho, alto, 1).create())
        val c = pagina.canvas
        var y = 24f
        for (l in lineas) {
            if (l.separador) { c.drawLine(10f, y - 4, ancho - 10f, y - 4, normal); y += 8; continue }
            val p = when { l.grande -> grande; l.negrita -> negrita; else -> normal }
            for (parte in EscPos.partir(l.texto, if (l.grande) columnas / 2 + 2 else columnas)) {
                val x = if (l.centro) (ancho - p.measureText(parte)) / 2 else 10f
                c.drawText(parte, x, y, p)
                y += if (l.grande) 18 else 12
            }
        }
        doc.finishPage(pagina)

        val carpeta = File(ctx.cacheDir, "recibos").apply { mkdirs() }
        carpeta.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 86_400_000 }?.forEach { it.delete() }
        val archivo = File(carpeta, "recibo-${d.movimiento.id.toString().padStart(7, '0')}.pdf")
        FileOutputStream(archivo).use { doc.writeTo(it) }
        doc.close()
        return archivo
    }

    fun uri(ctx: Context, archivo: File): Uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.archivos", archivo)

    /** Abre el menú de compartir (WhatsApp, correo, Drive…). */
    fun compartir(ctx: Context, archivo: File) {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri(ctx, archivo))
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        ctx.startActivity(Intent.createChooser(intent, "Compartir recibo").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** Impresión con el sistema de Android (impresoras WiFi o "Guardar como PDF"). */
    fun imprimirSistema(ctx: Context, archivo: File) {
        val pm = ctx.getSystemService(PrintManager::class.java) ?: return
        pm.print("Recibo SIGPAR", object : PrintDocumentAdapter() {
            override fun onLayout(o: PrintAttributes?, n: PrintAttributes?, s: CancellationSignal?, cb: LayoutResultCallback, e: Bundle?) {
                cb.onLayoutFinished(PrintDocumentInfo.Builder(archivo.name).setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).build(), true)
            }
            override fun onWrite(p: Array<out PageRange>?, destino: ParcelFileDescriptor, s: CancellationSignal?, cb: WriteResultCallback) {
                runCatching {
                    archivo.inputStream().use { i -> FileOutputStream(destino.fileDescriptor).use { o -> i.copyTo(o) } }
                    cb.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
                }.onFailure { cb.onWriteFailed(it.message) }
            }
        }, null)
    }

    /** WhatsApp con el mensaje ya escrito al número del cliente (gratis, sin API). */
    fun abrirWhatsApp(ctx: Context, numeroInternacional: String, texto: String): Boolean = try {
        ctx.startActivity(Intent(Intent.ACTION_VIEW, "https://wa.me/$numeroInternacional?text=${Uri.encode(texto)}".toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (_: ActivityNotFoundException) { false }
}
