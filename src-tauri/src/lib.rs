use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;
use tauri::Manager;

static PYTHON_PATH: OnceLock<String> = OnceLock::new();

fn get_python_exe() -> &'static str {
    PYTHON_PATH.get_or_init(|| {
        let candidates = vec![
            "python3",
            "/opt/homebrew/bin/python3",
            "/usr/local/bin/python3",
            "/opt/miniconda3/bin/python3",
            "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3",
        ];

        for python_bin in candidates {
            let test_status = Command::new(python_bin)
                .arg("-c")
                .arg("import pypdf; import reportlab; import PIL; import openpyxl; import xlrd; import docx")
                .output();

            if let Ok(output) = test_status {
                if output.status.success() {
                    return python_bin.to_string();
                }
            }
        }
        "python3".to_string()
    })
}

fn processor_script_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let current_dir = std::env::current_dir().map_err(|e| e.to_string())?;
    let candidates = [
        app.path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("scripts")
            .join("fdr_processor.py"),
        current_dir
            .join("src-tauri")
            .join("scripts")
            .join("fdr_processor.py"),
        current_dir.join("scripts").join("fdr_processor.py"),
    ];

    candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| "Python processor script not found in app resources".to_string())
}

#[tauri::command]
fn unzip_and_scan(
    app: tauri::AppHandle,
    file_path: String,
    out_dir: String,
) -> Result<String, String> {
    let script_path = processor_script_path(&app)?;

    // 如果 out_dir 为空，自动在系统临时目录生成一个唯一的子文件夹
    let mut final_out_dir = out_dir;
    if final_out_dir.is_empty() {
        let temp_sys = app.path().temp_dir().map_err(|e| e.to_string())?;
        let micros = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_micros();
        final_out_dir = temp_sys
            .join(format!("fdr_ext_{}", micros))
            .to_string_lossy()
            .to_string();
    }

    // 1. 执行 unzip
    let unzip_output = Command::new(get_python_exe())
        .arg(&script_path)
        .arg("--action")
        .arg("unzip")
        .arg("--file")
        .arg(&file_path)
        .arg("--outdir")
        .arg(&final_out_dir)
        .output()
        .map_err(|e| format!("Failed to spawn python process: {}", e))?;

    if !unzip_output.status.success() {
        let err_msg = String::from_utf8_lossy(&unzip_output.stderr).to_string();
        return Err(format!("Unzip failed: {}", err_msg));
    }

    let unzip_res_str = String::from_utf8_lossy(&unzip_output.stdout).to_string();
    let unzip_res: serde_json::Value = serde_json::from_str(&unzip_res_str)
        .map_err(|e| format!("Invalid JSON from unzip: {}", e))?;

    if unzip_res["status"] == "error" {
        return Err(unzip_res["message"]
            .as_str()
            .unwrap_or("Unknown unzip error")
            .to_string());
    }

    // 2. 执行 scan
    let scan_output = Command::new(get_python_exe())
        .arg(&script_path)
        .arg("--action")
        .arg("scan")
        .arg("--dir")
        .arg(&final_out_dir)
        .output()
        .map_err(|e| format!("Failed to spawn python process for scan: {}", e))?;

    if !scan_output.status.success() {
        let err_msg = String::from_utf8_lossy(&scan_output.stderr).to_string();
        return Err(format!("Scan failed: {}", err_msg));
    }

    let scan_res_str = String::from_utf8_lossy(&scan_output.stdout).to_string();
    Ok(scan_res_str)
}

#[tauri::command]
fn generate_merged_pdf(
    app: tauri::AppHandle,
    files_json: String,
    output_path: String,
    temp_dir: String,
) -> Result<String, String> {
    let script_path = processor_script_path(&app)?;

    // 把 files_json 写入临时配置文件
    let temp_json_path = std::path::Path::new(&temp_dir).join("temp_merge_config.json");
    std::fs::write(&temp_json_path, &files_json)
        .map_err(|e| format!("Failed to write temp merge config: {}", e))?;

    // 调用 Python merge
    let merge_output = Command::new(get_python_exe())
        .arg(&script_path)
        .arg("--action")
        .arg("merge")
        .arg("--file")
        .arg(&temp_json_path)
        .arg("--output")
        .arg(&output_path)
        .output()
        .map_err(|e| format!("Failed to spawn python process for merge: {}", e))?;

    // 清理临时文件
    let _ = std::fs::remove_file(&temp_json_path);

    if !merge_output.status.success() {
        let err_msg = String::from_utf8_lossy(&merge_output.stderr).to_string();
        return Err(format!("Merge process failed: {}", err_msg));
    }

    let merge_res_str = String::from_utf8_lossy(&merge_output.stdout).to_string();
    let merge_res: serde_json::Value = serde_json::from_str(&merge_res_str)
        .map_err(|e| format!("Invalid JSON from merge: {}", e))?;

    if merge_res["status"] == "error" {
        return Err(merge_res["message"]
            .as_str()
            .unwrap_or("Unknown merge error")
            .to_string());
    }

    Ok(merge_res["message"]
        .as_str()
        .unwrap_or("Merged successfully")
        .to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            unzip_and_scan,
            generate_merged_pdf
        ])
        .setup(|app| {
            app.handle().plugin(tauri_plugin_dialog::init())?;
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
