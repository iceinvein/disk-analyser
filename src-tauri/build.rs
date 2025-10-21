fn main() {
    // Add LSApplicationCategoryType to Info.plist for Mac App Store
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-env=MACOSX_DEPLOYMENT_TARGET=10.13");
    }
    
    tauri_build::build()
}
