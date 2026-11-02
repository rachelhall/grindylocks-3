import ExpoModulesCore
import Network
import UIKit

/// Whether clips should autoplay: off under Low Data Mode, and off when
/// Settings › Accessibility › Motion › Auto-Play Video Previews is off.
public final class DataSaverModule: Module {
  private let monitor = NWPathMonitor()
  private let queue = DispatchQueue(label: "com.grindylocks.data-saver")

  public func definition() -> ModuleDefinition {
    Name("GrindylocksDataSaver")

    OnCreate {
      self.monitor.start(queue: self.queue)
    }

    OnDestroy {
      self.monitor.cancel()
    }

    AsyncFunction("getStateAsync") { () -> [String: Bool] in
      return [
        "lowData": self.monitor.currentPath.isConstrained,
        "autoplayVideo": UIAccessibility.isVideoAutoplayEnabled,
      ]
    }.runOnQueue(.main)
  }
}
