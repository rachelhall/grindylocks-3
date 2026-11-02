Pod::Spec.new do |s|
  s.name           = 'DataSaver'
  s.version        = '1.0.0'
  s.summary        = 'Low Data Mode and the video auto-play setting, for clip autoplay'
  s.description    = 'Tells the app whether iOS Low Data Mode is on and whether Auto-Play Video Previews is off.'
  s.author         = ''
  s.homepage       = 'https://grindylocks.com'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
