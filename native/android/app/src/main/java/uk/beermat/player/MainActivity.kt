package uk.beermat.player

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import uk.beermat.player.game.PlayerViewModel
import uk.beermat.player.ui.BeerMatApp
import uk.beermat.player.ui.BeerMatTheme

class MainActivity : ComponentActivity() {
    private val vm: PlayerViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Leaving the app during an open question is reported, as a browser tab going to the background is.
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) = vm.away("away")
            override fun onStart(owner: LifecycleOwner) = vm.away("back")
        })
        setContent {
            BeerMatTheme {
                val ui = vm.ui.collectAsStateWithLifecycle().value
                BeerMatApp(vm, ui, scan = ::scan)
            }
        }
    }

    /** Google's code scanner: the camera runs in Play services, so this app never asks for the camera. */
    private fun scan() {
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).enableAutoZoom().build()
        GmsBarcodeScanning.getClient(this, options).startScan()
            .addOnSuccessListener { code -> code.rawValue?.let(vm::scanned) }
            .addOnFailureListener { vm.say("The scanner isn't available on this phone. Type the address on the TV instead.", true) }
    }
}
