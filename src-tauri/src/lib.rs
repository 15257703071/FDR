use printpdf::{
    Mm, Op, PdfDocument as PrintPdfDocument, PdfPage, PdfSaveOptions, Pt, RawImage,
    XObjectTransform,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;
use zip::ZipArchive;

#[derive(Serialize, Clone)]
struct FileEntry {
    name: String,
    path: String,
    #[serde(rename = "type")]
    file_type: String,
    size_bytes: u64,
}

#[derive(Serialize)]
struct VehicleFolder {
    name: String,
    path: String,
    files: Vec<FileEntry>,
}

#[derive(Serialize)]
struct ScanData {
    root_dir: String,
    vehicle_folders: Vec<VehicleFolder>,
    other_files: Vec<FileEntry>,
}

#[derive(Deserialize)]
struct MergeEntry {
    path: String,
    #[serde(rename = "type")]
    file_type: String,
}

fn json_success(data: serde_json::Value) -> String {
    json!({ "status": "success", "data": data }).to_string()
}

fn file_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" | "png" => "image",
        "pdf" => "pdf",
        "xlsx" | "xls" => "excel",
        "docx" | "doc" => "word",
        _ => "unknown",
    }
}

fn entry_for(path: &Path) -> Result<FileEntry, String> {
    Ok(FileEntry {
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string(),
        path: path.to_string_lossy().to_string(),
        file_type: file_type(path).to_string(),
        size_bytes: fs::metadata(path).map_err(|e| e.to_string())?.len(),
    })
}

fn is_vehicle_folder(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    name.split('-').any(|part| part.parse::<usize>().is_ok())
}

fn scan_dir_recursive(
    root: &Path,
    vehicles: &mut Vec<VehicleFolder>,
    others: &mut Vec<FileEntry>,
    in_vehicle: bool,
) -> Result<(), String> {
    let current_is_vehicle = !in_vehicle && is_vehicle_folder(root);
    let mut files = Vec::new();
    let mut dirs = Vec::new();

    for item in fs::read_dir(root).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let path = item.path();
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with('.'))
        {
            continue;
        }
        if path.is_dir() {
            dirs.push(path);
        } else {
            files.push(path);
        }
    }

    if current_is_vehicle {
        let mut vehicle_files = files
            .iter()
            .map(|path| entry_for(path))
            .collect::<Result<Vec<_>, _>>()?;
        vehicle_files
            .sort_by(|a, b| (a.file_type != "pdf", &a.name).cmp(&(b.file_type != "pdf", &b.name)));
        vehicles.push(VehicleFolder {
            name: root
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string(),
            path: root.to_string_lossy().to_string(),
            files: vehicle_files,
        });
    } else if !in_vehicle {
        for path in files {
            others.push(entry_for(&path)?);
        }
    }

    for dir in dirs {
        scan_dir_recursive(&dir, vehicles, others, in_vehicle || current_is_vehicle)?;
    }

    Ok(())
}

fn scan_directory(dir: &Path) -> Result<ScanData, String> {
    let mut vehicle_folders = Vec::new();
    let mut other_files = Vec::new();
    scan_dir_recursive(dir, &mut vehicle_folders, &mut other_files, false)?;
    vehicle_folders.sort_by_key(|folder| {
        folder
            .name
            .split('-')
            .next()
            .and_then(|prefix| prefix.parse::<usize>().ok())
            .unwrap_or(usize::MAX)
    });

    Ok(ScanData {
        root_dir: dir.to_string_lossy().to_string(),
        vehicle_folders,
        other_files,
    })
}

fn unzip_zip(file_path: &Path, out_dir: &Path) -> Result<(), String> {
    let file = File::open(file_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(enclosed_name) = file.enclosed_name() else {
            continue;
        };
        let out_path = out_dir.join(enclosed_name);
        if file.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out_file = File::create(&out_path).map_err(|e| e.to_string())?;
        io::copy(&mut file, &mut out_file).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn helper_bin(app: &tauri::AppHandle, names: &[&str]) -> Option<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        dirs.push(resource_dir.join("bin"));
        dirs.push(resource_dir);
    }
    if let Ok(current_dir) = std::env::current_dir() {
        dirs.push(current_dir.join("src-tauri").join("bin"));
        dirs.push(current_dir.join("bin"));
    }

    dirs.into_iter()
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .find(|path| path.exists())
}

fn first_existing(paths: &[&str]) -> Option<PathBuf> {
    paths.iter().map(PathBuf::from).find(|path| path.exists())
}

fn unzip_rar(app: &tauri::AppHandle, file_path: &Path, out_dir: &Path) -> Result<(), String> {
    let seven_zip = helper_bin(app, &["7zz", "7zz.exe", "7z", "7z.exe"]).or_else(|| {
        first_existing(&[
            "/usr/local/bin/7zz",
            "/opt/homebrew/bin/7zz",
            "/usr/bin/7zz",
            "/usr/bin/7z",
            "C:\\Program Files\\7-Zip\\7zz.exe",
            "C:\\Program Files\\7-Zip\\7z.exe",
        ])
    });

    if let Some(seven_zip) = seven_zip {
        let output = Command::new(seven_zip)
            .arg("x")
            .arg("-y")
            .arg(format!("-o{}", out_dir.to_string_lossy()))
            .arg(file_path)
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            return Ok(());
        }
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let unar = first_existing(&[
        "/opt/homebrew/bin/unar",
        "/usr/local/bin/unar",
        "/usr/bin/unar",
    ]);
    if let Some(unar) = unar {
        let output = Command::new(unar)
            .arg("-o")
            .arg(out_dir)
            .arg("-f")
            .arg(file_path)
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            return Ok(());
        }
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Err("RAR 解压工具缺失：安装包内未找到 7-Zip。请重新下载最新安装包。".to_string())
}

fn unzip_archive(app: &tauri::AppHandle, file_path: &Path, out_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;
    match file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "zip" => unzip_zip(file_path, out_dir),
        "rar" | "cbr" => unzip_rar(app, file_path, out_dir),
        ext => Err(format!("不支持的压缩包格式: {ext}")),
    }
}

fn soffice_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.extend([
            resource_dir
                .join("vendor")
                .join("libreoffice")
                .join("LibreOffice.app")
                .join("Contents")
                .join("MacOS")
                .join("soffice"),
            resource_dir
                .join("vendor")
                .join("libreoffice")
                .join("LibreOffice")
                .join("program")
                .join("soffice.exe"),
            resource_dir
                .join("vendor")
                .join("libreoffice")
                .join("program")
                .join("soffice"),
        ]);
    }
    candidates.extend([
        PathBuf::from("/Applications/LibreOffice.app/Contents/MacOS/soffice"),
        PathBuf::from("C:\\Program Files\\LibreOffice\\program\\soffice.exe"),
        PathBuf::from("/usr/bin/soffice"),
        PathBuf::from("/usr/local/bin/soffice"),
    ]);

    candidates.into_iter().find(|path| path.exists())
}

fn convert_office_to_pdf(
    app: &tauri::AppHandle,
    office_path: &Path,
    output_dir: &Path,
) -> Result<PathBuf, String> {
    let soffice = soffice_path(app).ok_or_else(|| {
        "未找到 LibreOffice。正式安装包应内置 LibreOffice，请重新下载最新安装包。".to_string()
    })?;
    let base_name = office_path
        .file_stem()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "文件名无效".to_string())?;
    let output_pdf = output_dir.join(format!("{base_name}.pdf"));
    let _ = fs::remove_file(&output_pdf);
    let convert_to = match file_type(office_path) {
        "excel" => {
            r#"pdf:calc_pdf_Export:{"SinglePageSheets":{"type":"boolean","value":"true"},"ExportHiddenSheets":{"type":"boolean","value":"true"}}"#
        }
        _ => "pdf",
    };
    let output = Command::new(soffice)
        .arg("--headless")
        .arg("--nologo")
        .arg("--norestore")
        .arg("--convert-to")
        .arg(convert_to)
        .arg("--outdir")
        .arg(output_dir)
        .arg(office_path)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() && output_pdf.exists() {
        Ok(output_pdf)
    } else {
        Err(format!(
            "LibreOffice 转换失败: {}{}",
            String::from_utf8_lossy(&output.stderr),
            String::from_utf8_lossy(&output.stdout)
        ))
    }
}

fn write_image_pdf(image_path: &Path, output_path: &Path) -> Result<(), String> {
    let bytes = fs::read(image_path).map_err(|e| e.to_string())?;
    let image = RawImage::decode_from_bytes(&bytes, &mut Vec::new())?;
    let page_w_pt = 595.2756;
    let page_h_pt = 841.8898;
    let margin = 15.0;
    let scale = ((page_w_pt - margin * 2.0) / image.width as f32)
        .min((page_h_pt - margin * 2.0) / image.height as f32)
        .min(1.0);
    let w = image.width as f32 * scale;
    let h = image.height as f32 * scale;
    let x = (page_w_pt - w) / 2.0;
    let y = (page_h_pt - h) / 2.0;

    let mut doc = PrintPdfDocument::new("image");
    let image_id = doc.add_image(&image);
    doc.with_pages(vec![PdfPage::new(
        Mm(210.0),
        Mm(297.0),
        vec![Op::UseXobject {
            id: image_id,
            transform: XObjectTransform {
                translate_x: Some(Pt(x)),
                translate_y: Some(Pt(y)),
                scale_x: Some(scale),
                scale_y: Some(scale),
                dpi: Some(72.0),
                ..Default::default()
            },
        }],
    )]);
    let bytes = doc.save(&PdfSaveOptions::default(), &mut Vec::new());
    fs::write(output_path, bytes).map_err(|e| e.to_string())
}

fn merge_pdf_paths(pdf_paths: &[PathBuf], output_path: &Path) -> Result<(), String> {
    let mut max_id = 1;
    let mut documents_pages = BTreeMap::new();
    let mut documents_objects = BTreeMap::new();
    let mut document = lopdf::Document::with_version("1.5");

    for path in pdf_paths {
        let mut doc = lopdf::Document::load(path).map_err(|e| e.to_string())?;
        if doc.is_encrypted() {
            doc.decrypt("").map_err(|e| e.to_string())?;
        }
        doc.renumber_objects_with(max_id);
        max_id = doc.max_id + 1;

        for object_id in doc.get_pages().into_values() {
            let object = doc
                .get_object(object_id)
                .map_err(|e| e.to_string())?
                .to_owned();
            documents_pages.insert(object_id, object);
        }
        documents_objects.extend(doc.objects);
    }

    let mut catalog_object = None;
    let mut pages_object = None;

    for (object_id, object) in documents_objects {
        match object.type_name().unwrap_or(b"") {
            b"Catalog" => {
                catalog_object.get_or_insert((object_id, object));
            }
            b"Pages" => {
                pages_object.get_or_insert((object_id, object));
            }
            b"Page" | b"Outlines" | b"Outline" => {}
            _ => {
                document.objects.insert(object_id, object);
            }
        }
    }

    let (catalog_id, catalog_object) = catalog_object.ok_or("PDF Catalog root not found")?;
    let (pages_id, pages_object) = pages_object.ok_or("PDF Pages root not found")?;

    for (object_id, object) in documents_pages.iter() {
        let mut dictionary = object.as_dict().map_err(|e| e.to_string())?.clone();
        dictionary.set("Parent", pages_id);
        document
            .objects
            .insert(*object_id, lopdf::Object::Dictionary(dictionary));
    }

    let mut pages_dictionary = pages_object.as_dict().map_err(|e| e.to_string())?.clone();
    pages_dictionary.set("Count", documents_pages.len() as u32);
    pages_dictionary.set(
        "Kids",
        documents_pages
            .into_keys()
            .map(lopdf::Object::Reference)
            .collect::<Vec<_>>(),
    );
    document
        .objects
        .insert(pages_id, lopdf::Object::Dictionary(pages_dictionary));

    let mut catalog_dictionary = catalog_object.as_dict().map_err(|e| e.to_string())?.clone();
    catalog_dictionary.set("Pages", pages_id);
    catalog_dictionary.remove(b"Outlines");
    document
        .objects
        .insert(catalog_id, lopdf::Object::Dictionary(catalog_dictionary));
    document.trailer.set("Root", catalog_id);
    document.max_id = document.objects.len() as u32;
    document.renumber_objects();
    document
        .save(output_path)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn merge_files(
    app: &tauri::AppHandle,
    files_json: &str,
    output_path: &Path,
    temp_dir: &Path,
) -> Result<String, String> {
    let entries: Vec<MergeEntry> = serde_json::from_str(files_json).map_err(|e| e.to_string())?;
    let work_dir = temp_dir.join("fdr_pdf_work");
    fs::create_dir_all(&work_dir).map_err(|e| e.to_string())?;
    let mut processed = 0usize;
    let mut temp_pdfs = Vec::new();
    let mut pdf_paths = Vec::new();

    for (idx, entry) in entries.iter().enumerate() {
        let path = PathBuf::from(&entry.path);
        let kind = entry.file_type.as_str();
        if !path.exists() {
            continue;
        }

        let pdf = match kind {
            "pdf" => path,
            "image" => {
                let pdf = work_dir.join(format!("_temp_img_{idx}.pdf"));
                write_image_pdf(&path, &pdf)?;
                pdf
            }
            "excel" | "word" => convert_office_to_pdf(app, &path, &work_dir)?,
            _ => continue,
        };
        pdf_paths.push(pdf.clone());
        if !matches!(kind, "pdf") {
            temp_pdfs.push(pdf);
        }
        processed += 1;
    }

    if pdf_paths.is_empty() {
        return Err("没有可合并的有效文件".to_string());
    }

    merge_pdf_paths(&pdf_paths, output_path)?;
    for pdf in temp_pdfs {
        let _ = fs::remove_file(pdf);
    }
    Ok(format!("成功合并 {processed} 个文件"))
}

#[tauri::command]
fn unzip_and_scan(
    app: tauri::AppHandle,
    file_path: String,
    out_dir: String,
) -> Result<String, String> {
    let mut final_out_dir = PathBuf::from(out_dir);
    if final_out_dir.as_os_str().is_empty() {
        let micros = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_micros();
        final_out_dir = app
            .path()
            .temp_dir()
            .map_err(|e| e.to_string())?
            .join(format!("fdr_ext_{micros}"));
    }

    unzip_archive(&app, Path::new(&file_path), &final_out_dir)?;
    let data = scan_directory(&final_out_dir)?;
    Ok(json_success(
        serde_json::to_value(data).map_err(|e| e.to_string())?,
    ))
}

#[tauri::command]
fn generate_merged_pdf(
    app: tauri::AppHandle,
    files_json: String,
    output_path: String,
    temp_dir: String,
) -> Result<String, String> {
    merge_files(
        &app,
        &files_json,
        Path::new(&output_path),
        Path::new(&temp_dir),
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            unzip_and_scan,
            generate_merged_pdf
        ])
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use printpdf::{BuiltinFont, PdfFontHandle, TextItem};

    fn write_test_pdf(path: &Path, text: &str) {
        let mut doc = PrintPdfDocument::new("test");
        doc.with_pages(vec![PdfPage::new(
            Mm(210.0),
            Mm(297.0),
            vec![
                Op::StartTextSection,
                Op::SetTextCursor {
                    pos: printpdf::Point::new(Mm(20.0), Mm(260.0)),
                },
                Op::SetFont {
                    font: PdfFontHandle::Builtin(BuiltinFont::Helvetica),
                    size: Pt(16.0),
                },
                Op::ShowText {
                    items: vec![TextItem::Text(text.to_string())],
                },
                Op::EndTextSection,
            ],
        )]);
        fs::write(path, doc.save(&PdfSaveOptions::default(), &mut Vec::new())).unwrap();
    }

    #[test]
    fn merge_pdf_paths_keeps_all_pages() {
        let dir = std::env::temp_dir().join(format!(
            "fdr_merge_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let first = dir.join("first.pdf");
        let second = dir.join("second.pdf");
        let merged = dir.join("merged.pdf");
        write_test_pdf(&first, "first");
        write_test_pdf(&second, "second");

        merge_pdf_paths(&[first, second], &merged).unwrap();

        let pages = lopdf::Document::load(&merged).unwrap().get_pages().len();
        let _ = fs::remove_dir_all(dir);
        assert_eq!(pages, 2);
    }
}
