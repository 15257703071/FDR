use image::{DynamicImage, GrayImage, RgbImage};
use ocr_rs::{OcrEngine, OcrEngineConfig};
use regex::Regex;
use serde::Serialize;
use serde_json::json;
use std::collections::{BTreeMap, HashMap};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

#[derive(Debug, Serialize)]
pub struct HeaderItem {
    col: String,
    name: String,
}

#[derive(Clone, Debug)]
struct ImageTask {
    row_num: usize,
    image_path: String,
}

#[derive(Clone, Debug)]
struct MatchRow {
    row_num: usize,
    name: String,
    reg_vin: String,
    ocr_vin: String,
    all_vins: String,
    texts_debug: String,
    status: String,
    reg_duplicate: bool,
    ocr_duplicate: bool,
    matched: bool,
    reg_len_ok: bool,
    ocr_len_ok: bool,
    reg_check_ok: bool,
    ocr_check_ok: bool,
}

pub fn headers(file_path: &str) -> Result<String, String> {
    let data = read_xlsx_data(Path::new(file_path))?;
    let mut headers = Vec::new();

    for row_num in 1..=5 {
        let row_values = (1..=60)
            .map(|idx| {
                let col = index_to_col(idx);
                data.cells
                    .get(&(row_num, col.clone()))
                    .cloned()
                    .unwrap_or_default()
            })
            .collect::<Vec<_>>();
        let non_empty = row_values.iter().filter(|value| !value.is_empty()).count();
        if non_empty > 3 {
            for (idx, value) in row_values.into_iter().enumerate() {
                let col = index_to_col(idx + 1);
                headers.push(HeaderItem {
                    col: col.clone(),
                    name: if value.is_empty() {
                        format!("{col} 列")
                    } else {
                        format!("{col} 列 ({value})")
                    },
                });
            }
            break;
        }
    }

    if headers.is_empty() {
        headers = (1..=50)
            .map(|idx| {
                let col = index_to_col(idx);
                HeaderItem {
                    col: col.clone(),
                    name: format!("{col} 列"),
                }
            })
            .collect();
    }

    Ok(json!({ "status": "success", "headers": headers }).to_string())
}

pub fn run_match(
    window: tauri::Window,
    app_handle: tauri::AppHandle,
    file_path: String,
    vin_col: String,
    img_col: String,
) -> Result<String, String> {
    std::thread::spawn(move || {
        if let Err(err) = run_match_inner(&window, &app_handle, &file_path, &vin_col, &img_col) {
            emit_error(&window, &err);
        }
    });
    Ok("started".to_string())
}

fn run_match_inner(
    window: &tauri::Window,
    app_handle: &tauri::AppHandle,
    file_path: &str,
    vin_col: &str,
    img_col: &str,
) -> Result<(), String> {
    emit_status(window, "正在读取 Excel 并定位合格证图片...", None, None);

    let path = Path::new(file_path);
    let data = read_xlsx_data(path)?;
    let img_col_idx = col_to_index(img_col)?;
    let mut tasks = data
        .images
        .iter()
        .filter(|task| {
            task.image_path.starts_with("xl/media/")
                && data
                    .image_cols
                    .get(&task.image_path)
                    .is_some_and(|col_idx| *col_idx == img_col_idx)
        })
        .cloned()
        .collect::<Vec<_>>();
    tasks.sort_by_key(|task| task.row_num);

    if tasks.is_empty() {
        return Err(format!(
            "在选定的 {img_col} 列中没有找到嵌入的合格证图片，请重新选择"
        ));
    }

    let total = tasks.len();
    emit_status(
        window,
        &format!("已找到 {total} 张图片，正在加载 Rust OCR tiny 模型..."),
        Some(0),
        Some(total),
    );

    let engine = load_ocr_engine(app_handle)?;

    emit_status(
        window,
        "Rust OCR 模型已就绪，开始识别第 1 张图片...",
        Some(0),
        Some(total),
    );

    let input = File::open(path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(input).map_err(|e| e.to_string())?;
    let vin_re = Regex::new(r"(?i)[A-Z0-9]{17}").map_err(|e| e.to_string())?;
    let vin_counts = count_registered_vins(&data.cells, vin_col, &vin_re);
    let mut rows = Vec::new();

    for (idx, task) in tasks.iter().enumerate() {
        let row_num = task.row_num;
        let reg_vin = data
            .cells
            .get(&(row_num, vin_col.to_string()))
            .and_then(|value| first_vin_candidate(&vin_re, value))
            .unwrap_or_default();
        let name = guess_name(&data.cells, row_num);
        let image_bytes = read_zip_entry(&mut archive, &task.image_path)?;
        let image = image::load_from_memory(&image_bytes)
            .map_err(|e| format!("第 {row_num} 行图片解码失败: {e}"))?;

        let ocr_texts = recognize_texts(&engine, &image)?;
        let matched_vins = collect_vins(&vin_re, &ocr_texts);
        let ocr_vin = choose_ocr_vin(&matched_vins, &reg_vin);
        let reg_duplicate_count = vin_counts.get(&reg_vin).copied().unwrap_or(0);
        let status = match_status(&reg_vin, &ocr_vin, reg_duplicate_count, 0).to_string();
        let texts_debug = ocr_texts
            .iter()
            .take(10)
            .cloned()
            .collect::<Vec<_>>()
            .join(" | ");

        rows.push(MatchRow {
            row_num,
            name: name.clone(),
            reg_vin: reg_vin.clone(),
            ocr_vin: ocr_vin.clone(),
            all_vins: matched_vins.join(","),
            texts_debug: texts_debug.clone(),
            status: status.clone(),
            reg_duplicate: reg_duplicate_count > 1,
            ocr_duplicate: false,
            matched: !reg_vin.is_empty() && ocr_vin != "未识别到" && reg_vin == ocr_vin,
            reg_len_ok: reg_vin.len() == 17,
            ocr_len_ok: ocr_vin.len() == 17,
            reg_check_ok: vin_check_digit_ok(&reg_vin),
            ocr_check_ok: vin_check_digit_ok(&ocr_vin),
        });

        let current = idx + 1;
        let _ = window.emit(
            "ocr-progress",
            json!({
                "type": "progress",
                "row": row_num,
                "name": name,
                "reg_vin": reg_vin,
                "ocr_vin": ocr_vin,
                "all_vins": matched_vins.join(","),
                "status": status,
                "reg_duplicate": reg_duplicate_count > 1,
                "ocr_duplicate": false,
                "matched": !reg_vin.is_empty() && ocr_vin != "未识别到" && reg_vin == ocr_vin,
                "reg_len_ok": reg_vin.len() == 17,
                "ocr_len_ok": ocr_vin.len() == 17,
                "reg_check_ok": vin_check_digit_ok(&reg_vin),
                "ocr_check_ok": vin_check_digit_ok(&ocr_vin),
                "texts_debug": texts_debug,
                "current": current,
                "total": total
            })
            .to_string(),
        );
    }

    let ocr_counts = count_ocr_vins(&rows);
    for row in &mut rows {
        let reg_duplicate_count = vin_counts.get(&row.reg_vin).copied().unwrap_or(0);
        let ocr_duplicate_count = ocr_counts.get(&row.ocr_vin).copied().unwrap_or(0);
        apply_checks(row, reg_duplicate_count, ocr_duplicate_count);
        let _ = window.emit("ocr-progress", row_payload(row, total).to_string());
    }

    emit_status(
        window,
        "识别完成，正在保存比对结果...",
        Some(total),
        Some(total),
    );
    let output_path = output_path(path);
    write_results_xlsx(
        path,
        &output_path,
        col_to_index(img_col)? + 1,
        find_header_row(&data.cells),
        &rows,
    )?;
    let _ = window.emit(
        "ocr-progress",
        json!({
            "type": "done",
            "status": "success",
            "output_path": output_path.to_string_lossy()
        })
        .to_string(),
    );

    Ok(())
}

pub fn run_folder_match(
    window: tauri::Window,
    app_handle: tauri::AppHandle,
    root_dir: String,
) -> Result<String, String> {
    std::thread::spawn(move || {
        if let Err(err) = run_folder_match_inner(&window, &app_handle, &root_dir) {
            emit_error(&window, &err);
        }
    });
    Ok("started".to_string())
}

fn run_folder_match_inner(
    window: &tauri::Window,
    app_handle: &tauri::AppHandle,
    root_dir: &str,
) -> Result<(), String> {
    let root = Path::new(root_dir);
    emit_status(window, "正在扫描车架号文件夹...", None, None);
    let vin_re = Regex::new(r"(?i)[A-Z0-9]{17}").map_err(|e| e.to_string())?;
    let mut folders = fs::read_dir(root)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    folders.sort();
    if folders.is_empty() {
        return Err("所选目录下没有车架号子文件夹".to_string());
    }

    let folder_vins = folders
        .iter()
        .map(|path| {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            folder_vin_candidate(&vin_re, name).unwrap_or_default()
        })
        .collect::<Vec<_>>();
    let vin_counts = folder_vins.iter().fold(HashMap::new(), |mut counts, vin| {
        if !vin.is_empty() {
            *counts.entry(vin.clone()).or_insert(0) += 1;
        }
        counts
    });

    emit_status(
        window,
        &format!(
            "已找到 {} 个车架号文件夹，正在加载 Rust OCR tiny 模型...",
            folders.len()
        ),
        Some(0),
        Some(folders.len()),
    );
    let engine = load_ocr_engine(app_handle)?;
    let mut rows = Vec::new();

    for (idx, folder) in folders.iter().enumerate() {
        let folder_name = folder
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string();
        let reg_vin = folder_vins.get(idx).cloned().unwrap_or_default();
        let cert_path = find_certificate_file(folder);
        let (ocr_texts, matched_vins) = match cert_path {
            Some(path) => recognize_certificate(&engine, &path, &vin_re)
                .unwrap_or_else(|err| (vec![err], Vec::new())),
            None => (vec!["未找到合格证文件".to_string()], Vec::new()),
        };
        let ocr_vin = choose_ocr_vin(&matched_vins, &reg_vin);
        let reg_duplicate_count = vin_counts.get(&reg_vin).copied().unwrap_or(0);
        let status = match_status(&reg_vin, &ocr_vin, reg_duplicate_count, 0).to_string();
        let texts_debug = ocr_texts
            .iter()
            .take(10)
            .cloned()
            .collect::<Vec<_>>()
            .join(" | ");
        rows.push(MatchRow {
            row_num: idx + 1,
            name: folder_name.clone(),
            reg_vin: reg_vin.clone(),
            ocr_vin: ocr_vin.clone(),
            all_vins: matched_vins.join(","),
            texts_debug: texts_debug.clone(),
            status: status.clone(),
            reg_duplicate: reg_duplicate_count > 1,
            ocr_duplicate: false,
            matched: !reg_vin.is_empty() && ocr_vin != "未识别到" && reg_vin == ocr_vin,
            reg_len_ok: reg_vin.len() == 17,
            ocr_len_ok: ocr_vin.len() == 17,
            reg_check_ok: vin_check_digit_ok(&reg_vin),
            ocr_check_ok: vin_check_digit_ok(&ocr_vin),
        });
        let _ = window.emit(
            "ocr-progress",
            json!({
                "type": "progress",
                "row": idx + 1,
                "name": folder_name,
                "reg_vin": reg_vin,
                "ocr_vin": ocr_vin,
                "all_vins": matched_vins.join(","),
                "status": status,
                "reg_duplicate": reg_duplicate_count > 1,
                "ocr_duplicate": false,
                "matched": !reg_vin.is_empty() && ocr_vin != "未识别到" && reg_vin == ocr_vin,
                "reg_len_ok": reg_vin.len() == 17,
                "ocr_len_ok": ocr_vin.len() == 17,
                "reg_check_ok": vin_check_digit_ok(&reg_vin),
                "ocr_check_ok": vin_check_digit_ok(&ocr_vin),
                "texts_debug": texts_debug,
                "current": idx + 1,
                "total": folders.len()
            })
            .to_string(),
        );
    }

    let ocr_counts = count_ocr_vins(&rows);
    for row in &mut rows {
        let reg_duplicate_count = vin_counts.get(&row.reg_vin).copied().unwrap_or(0);
        let ocr_duplicate_count = ocr_counts.get(&row.ocr_vin).copied().unwrap_or(0);
        apply_checks(row, reg_duplicate_count, ocr_duplicate_count);
        let _ = window.emit("ocr-progress", row_payload(row, folders.len()).to_string());
    }

    let output_path = root.join("文件夹OCR匹配结果.csv");
    write_folder_csv(&output_path, &rows)?;
    let _ = window.emit(
        "ocr-progress",
        json!({
            "type": "done",
            "status": "success",
            "output_path": output_path.to_string_lossy()
        })
        .to_string(),
    );
    Ok(())
}

fn load_ocr_engine(app_handle: &tauri::AppHandle) -> Result<OcrEngine, String> {
    let model_dir = find_model_dir(app_handle)?;
    OcrEngine::new(
        model_dir.join("PP-OCRv6_tiny_det.mnn"),
        model_dir.join("PP-OCRv6_tiny_rec.mnn"),
        model_dir.join("ppocr_keys_v6_tiny.txt"),
        Some(OcrEngineConfig::fast().with_min_result_confidence(0.5)),
    )
    .map_err(|e| format!("初始化 Rust OCR 模型失败: {e}"))
}

fn find_certificate_file(folder: &Path) -> Option<PathBuf> {
    let mut files = fs::read_dir(folder)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .is_some_and(|ext| {
                        matches!(
                            ext.to_ascii_lowercase().as_str(),
                            "pdf" | "jpg" | "jpeg" | "png"
                        )
                    })
        })
        .collect::<Vec<_>>();
    files.sort_by_key(|path| {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        (
            !name.contains("合格证"),
            path.extension().and_then(|e| e.to_str()) != Some("pdf"),
        )
    });
    files.into_iter().next()
}

fn recognize_certificate(
    engine: &OcrEngine,
    path: &Path,
    vin_re: &Regex,
) -> Result<(Vec<String>, Vec<String>), String> {
    let images = if path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
    {
        extract_pdf_images(path)?
    } else {
        vec![image::open(path).map_err(|e| e.to_string())?]
    };
    if images.is_empty() {
        return Err(format!("未从 {} 提取到可识别图片", path.display()));
    }

    let mut texts = Vec::new();
    let mut vins = Vec::new();
    for image in images {
        let image_texts = recognize_texts(engine, &image)?;
        for vin in collect_vins(vin_re, &image_texts) {
            if !vins.contains(&vin) {
                vins.push(vin);
            }
        }
        texts.extend(image_texts);
        if !vins.is_empty() {
            break;
        }
    }
    Ok((texts, vins))
}

fn extract_pdf_images(path: &Path) -> Result<Vec<DynamicImage>, String> {
    let mut doc = lopdf::Document::load(path).map_err(|e| e.to_string())?;
    if doc.is_encrypted() {
        doc.decrypt("").map_err(|e| e.to_string())?;
    }
    let mut images = Vec::new();
    for object in doc.objects.values() {
        let lopdf::Object::Stream(stream) = object else {
            continue;
        };
        if stream
            .dict
            .get(b"Subtype")
            .and_then(lopdf::Object::as_name)
            .ok()
            != Some(b"Image")
        {
            continue;
        }
        if let Some(image) = decode_pdf_image(stream) {
            images.push(image);
        }
    }
    Ok(images)
}

fn decode_pdf_image(stream: &lopdf::Stream) -> Option<DynamicImage> {
    let filters = stream.filters().unwrap_or_default();
    if filters
        .iter()
        .any(|filter| matches!(*filter, b"DCTDecode" | b"JPXDecode"))
    {
        return image::load_from_memory(&stream.content).ok();
    }

    let width = stream
        .dict
        .get(b"Width")
        .and_then(lopdf::Object::as_i64)
        .ok()? as u32;
    let height = stream
        .dict
        .get(b"Height")
        .and_then(lopdf::Object::as_i64)
        .ok()? as u32;
    let bits = stream
        .dict
        .get(b"BitsPerComponent")
        .and_then(lopdf::Object::as_i64)
        .ok()
        .unwrap_or(8);
    if bits != 8 {
        return None;
    }
    let data = stream.get_plain_content().ok()?;
    let color_space = stream
        .dict
        .get(b"ColorSpace")
        .and_then(lopdf::Object::as_name)
        .ok()
        .unwrap_or(b"DeviceRGB");
    match color_space {
        b"DeviceGray" => GrayImage::from_raw(width, height, data).map(DynamicImage::ImageLuma8),
        _ => RgbImage::from_raw(width, height, data).map(DynamicImage::ImageRgb8),
    }
}

fn write_folder_csv(output: &Path, rows: &[MatchRow]) -> Result<(), String> {
    let mut text = String::from(
        "\u{feff}文件夹,登记车架号,OCR识别车架号,OCR匹配结果,登记重复,OCR重复,匹配,登记17位,OCR17位,登记校验码,OCR校验码\n",
    );
    for row in rows {
        let values = [
            row.name.clone(),
            row.reg_vin.clone(),
            row.ocr_vin.clone(),
            row.status.clone(),
            yes_no(row.reg_duplicate).to_string(),
            yes_no(row.ocr_duplicate).to_string(),
            yes_no(row.matched).to_string(),
            yes_no(row.reg_len_ok).to_string(),
            yes_no(row.ocr_len_ok).to_string(),
            yes_no(row.reg_check_ok).to_string(),
            yes_no(row.ocr_check_ok).to_string(),
        ];
        text.push_str(&values.map(|value| csv_escape(&value)).join(","));
        text.push('\n');
    }
    fs::write(output, text).map_err(|e| e.to_string())
}

fn csv_escape(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

struct XlsxData {
    cells: BTreeMap<(usize, String), String>,
    images: Vec<ImageTask>,
    image_cols: HashMap<String, usize>,
}

fn read_xlsx_data(path: &Path) -> Result<XlsxData, String> {
    if !path.exists() {
        return Err(format!("文件不存在: {}", path.display()));
    }

    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;
    let shared = parse_shared_strings(&read_zip_text_optional(
        &mut archive,
        "xl/sharedStrings.xml",
    )?);
    let sheet_xml = read_zip_text(&mut archive, "xl/worksheets/sheet1.xml")?;
    let cells = parse_sheet_cells(&sheet_xml, &shared)?;
    let drawing_path = find_sheet_drawing_path(&mut archive, &sheet_xml)?;
    let (images, image_cols) = if let Some(drawing_path) = drawing_path {
        parse_drawing_images(&mut archive, &drawing_path)?
    } else {
        (Vec::new(), HashMap::new())
    };

    Ok(XlsxData {
        cells,
        images,
        image_cols,
    })
}

fn find_sheet_drawing_path(
    archive: &mut ZipArchive<File>,
    sheet_xml: &str,
) -> Result<Option<String>, String> {
    let rel_id = capture_attr(sheet_xml, "drawing", "r:id");
    let Some(rel_id) = rel_id else {
        return Ok(None);
    };
    let rels = read_zip_text_optional(archive, "xl/worksheets/_rels/sheet1.xml.rels")?;
    let Some(target) = find_relationship_target(&rels, &rel_id) else {
        return Ok(None);
    };
    Ok(Some(resolve_zip_path("xl/worksheets", &target)))
}

fn parse_drawing_images(
    archive: &mut ZipArchive<File>,
    drawing_path: &str,
) -> Result<(Vec<ImageTask>, HashMap<String, usize>), String> {
    let drawing_xml = read_zip_text(archive, drawing_path)?;
    let rels_path = drawing_rels_path(drawing_path)?;
    let rels_xml = read_zip_text(archive, &rels_path)?;
    let anchor_re = Regex::new(r#"(?s)<xdr:oneCellAnchor>.*?</xdr:oneCellAnchor>"#)
        .map_err(|e| e.to_string())?;
    let mut tasks = Vec::new();
    let mut image_cols = HashMap::new();

    for anchor in anchor_re.find_iter(&drawing_xml) {
        let xml = anchor.as_str();
        let col = capture_tag_usize(xml, "xdr:col").unwrap_or(usize::MAX) + 1;
        let row = capture_tag_usize(xml, "xdr:row").unwrap_or(usize::MAX) + 1;
        let Some(rel_id) = capture_attr(xml, "a:blip", "r:embed") else {
            continue;
        };
        let Some(target) = find_relationship_target(&rels_xml, &rel_id) else {
            continue;
        };
        let image_path = resolve_zip_path(
            Path::new(drawing_path)
                .parent()
                .and_then(|p| p.to_str())
                .unwrap_or("xl/drawings"),
            &target,
        );
        image_cols.insert(image_path.clone(), col);
        tasks.push(ImageTask {
            row_num: row,
            image_path,
        });
    }

    Ok((tasks, image_cols))
}

fn parse_shared_strings(xml: &str) -> Vec<String> {
    let Ok(si_re) = Regex::new(r#"(?s)<si\b.*?</si>"#) else {
        return Vec::new();
    };
    let Ok(t_re) = Regex::new(r#"(?s)<t(?:\s[^>]*)?>(.*?)</t>"#) else {
        return Vec::new();
    };
    si_re
        .find_iter(xml)
        .map(|item| {
            t_re.captures_iter(item.as_str())
                .filter_map(|cap| cap.get(1))
                .map(|m| xml_unescape(m.as_str()))
                .collect::<Vec<_>>()
                .join("")
        })
        .collect()
}

fn parse_sheet_cells(
    sheet_xml: &str,
    shared: &[String],
) -> Result<BTreeMap<(usize, String), String>, String> {
    let cell_re = Regex::new(r#"(?s)<c\b([^>]*)>(.*?)</c>"#).map_err(|e| e.to_string())?;
    let attr_re = Regex::new(r#"([A-Za-z:]+)="([^"]*)""#).map_err(|e| e.to_string())?;
    let value_re = Regex::new(r#"(?s)<v>(.*?)</v>"#).map_err(|e| e.to_string())?;
    let text_re = Regex::new(r#"(?s)<t(?:\s[^>]*)?>(.*?)</t>"#).map_err(|e| e.to_string())?;
    let mut cells = BTreeMap::new();

    for cap in cell_re.captures_iter(sheet_xml) {
        let attrs = cap.get(1).map(|m| m.as_str()).unwrap_or_default();
        let body = cap.get(2).map(|m| m.as_str()).unwrap_or_default();
        let attrs = attr_re
            .captures_iter(attrs)
            .filter_map(|cap| Some((cap.get(1)?.as_str(), cap.get(2)?.as_str())))
            .collect::<HashMap<_, _>>();
        let Some(cell_ref) = attrs.get("r") else {
            continue;
        };
        let Some((col, row)) = split_cell_ref(cell_ref) else {
            continue;
        };
        let raw = if attrs.get("t") == Some(&"inlineStr") {
            text_re
                .captures_iter(body)
                .filter_map(|cap| cap.get(1))
                .map(|m| xml_unescape(m.as_str()))
                .collect::<Vec<_>>()
                .join("")
        } else {
            value_re
                .captures(body)
                .and_then(|cap| cap.get(1))
                .map(|m| xml_unescape(m.as_str()))
                .unwrap_or_default()
        };
        let value = if attrs.get("t") == Some(&"s") {
            raw.parse::<usize>()
                .ok()
                .and_then(|idx| shared.get(idx).cloned())
                .unwrap_or_default()
        } else {
            raw
        };
        cells.insert((row, col), value);
    }

    Ok(cells)
}

fn write_results_xlsx(
    input: &Path,
    output: &Path,
    first_output_col_idx: usize,
    header_row: usize,
    rows: &[MatchRow],
) -> Result<(), String> {
    let input_file = File::open(input).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(input_file).map_err(|e| e.to_string())?;
    let output_file = File::create(output).map_err(|e| e.to_string())?;
    let mut writer = ZipWriter::new(output_file);

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();
        let options = SimpleFileOptions::default()
            .compression_method(match file.compression() {
                CompressionMethod::Stored => CompressionMethod::Stored,
                _ => CompressionMethod::Deflated,
            })
            .unix_permissions(0o644);

        if file.is_dir() {
            writer
                .add_directory(name, options)
                .map_err(|e| e.to_string())?;
            continue;
        }

        writer
            .start_file(name.clone(), options)
            .map_err(|e| e.to_string())?;
        if name == "xl/worksheets/sheet1.xml" {
            let mut xml = String::new();
            file.read_to_string(&mut xml).map_err(|e| e.to_string())?;
            let patched = patch_sheet_results(&xml, first_output_col_idx, header_row, rows)?;
            writer
                .write_all(patched.as_bytes())
                .map_err(|e| e.to_string())?;
        } else {
            std::io::copy(&mut file, &mut writer).map_err(|e| e.to_string())?;
        }
    }

    writer.finish().map_err(|e| e.to_string())?;
    Ok(())
}

fn patch_sheet_results(
    sheet_xml: &str,
    first_output_col_idx: usize,
    header_row: usize,
    rows: &[MatchRow],
) -> Result<String, String> {
    let headers = [
        "OCR识别车架号",
        "OCR匹配结果",
        "登记重复",
        "OCR重复",
        "匹配",
        "登记17位",
        "OCR17位",
        "登记校验码",
        "OCR校验码",
    ];
    let row_re =
        Regex::new(r#"(?s)<row\b[^>]*\br="(\d+)"[^>]*>.*?</row>"#).map_err(|e| e.to_string())?;
    let mut replacements = HashMap::new();
    for (idx, header) in headers.iter().enumerate() {
        let col = index_to_col(first_output_col_idx + idx);
        replacements.insert((header_row, col.clone()), header.to_string());
        for row in rows {
            replacements.insert((row.row_num, col.clone()), output_values(row)[idx].clone());
        }
    }
    let output_cols = (0..headers.len())
        .map(|idx| index_to_col(first_output_col_idx + idx))
        .collect::<Vec<_>>();

    let mut output = String::with_capacity(sheet_xml.len() + replacements.len() * 64);
    let mut last = 0;

    for cap in row_re.captures_iter(sheet_xml) {
        let Some(m) = cap.get(0) else {
            continue;
        };
        let row_num = cap
            .get(1)
            .and_then(|m| m.as_str().parse::<usize>().ok())
            .unwrap_or_default();
        output.push_str(&sheet_xml[last..m.start()]);
        let mut row_xml = m.as_str().to_string();
        for col in &output_cols {
            if let Some(value) = replacements.get(&(row_num, col.to_string())) {
                row_xml = patch_row_xml(&row_xml, col, row_num, value)?;
            }
        }
        output.push_str(&row_xml);
        last = m.end();
    }
    output.push_str(&sheet_xml[last..]);
    Ok(output)
}

fn patch_row_xml(row_xml: &str, col: &str, row_num: usize, value: &str) -> Result<String, String> {
    let cell_ref = format!("{col}{row_num}");
    let cell_xml = format!(
        r#"<c r="{cell_ref}" t="inlineStr"><is><t>{}</t></is></c>"#,
        xml_escape(value)
    );
    let existing_re = Regex::new(&format!(r#"(?s)<c\b[^>]*\br="{}"[^>]*>.*?</c>"#, cell_ref))
        .map_err(|e| e.to_string())?;
    if existing_re.is_match(row_xml) {
        Ok(existing_re.replace(row_xml, cell_xml).to_string())
    } else if let Some(pos) = row_xml.rfind("</row>") {
        let mut patched = row_xml.to_string();
        patched.insert_str(pos, &cell_xml);
        Ok(patched)
    } else {
        Ok(row_xml.to_string())
    }
}

fn output_values(row: &MatchRow) -> [String; 9] {
    [
        row.ocr_vin.clone(),
        row.status.clone(),
        yes_no(row.reg_duplicate).to_string(),
        yes_no(row.ocr_duplicate).to_string(),
        yes_no(row.matched).to_string(),
        yes_no(row.reg_len_ok).to_string(),
        yes_no(row.ocr_len_ok).to_string(),
        yes_no(row.reg_check_ok).to_string(),
        yes_no(row.ocr_check_ok).to_string(),
    ]
}

fn recognize_texts(engine: &OcrEngine, image: &DynamicImage) -> Result<Vec<String>, String> {
    engine
        .recognize(image)
        .map_err(|e| format!("OCR 识别失败: {e}"))
        .map(|items| items.into_iter().map(|item| item.text).collect())
}

fn collect_vins(vin_re: &Regex, texts: &[String]) -> Vec<String> {
    let mut vins = Vec::new();
    for text in texts {
        let clean = text.to_ascii_uppercase().replace([' ', '-', '_'], "");
        for item in vin_re.find_iter(&clean) {
            let vin = item.as_str().to_string();
            if !vins.contains(&vin) {
                vins.push(vin);
            }
        }
    }
    vins
}

fn first_vin_candidate(vin_re: &Regex, text: &str) -> Option<String> {
    vin_re
        .find(&text.to_ascii_uppercase().replace([' ', '-', '_'], ""))
        .map(|item| item.as_str().to_string())
}

fn folder_vin_candidate(vin_re: &Regex, name: &str) -> Option<String> {
    name.split(|ch: char| !ch.is_ascii_alphanumeric())
        .find_map(|part| first_vin_candidate(vin_re, part))
        .or_else(|| first_vin_candidate(vin_re, name))
}

fn choose_ocr_vin(candidates: &[String], reg_vin: &str) -> String {
    if candidates.is_empty() {
        return "未识别到".to_string();
    }
    if !reg_vin.is_empty() && candidates.iter().any(|vin| vin == reg_vin) {
        return reg_vin.to_string();
    }
    candidates
        .iter()
        .find(|vin| vin_check_digit_ok(vin))
        .cloned()
        .unwrap_or_else(|| candidates[0].clone())
}

fn count_registered_vins(
    cells: &BTreeMap<(usize, String), String>,
    vin_col: &str,
    vin_re: &Regex,
) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for ((_, col), value) in cells {
        if col != vin_col {
            continue;
        }
        if let Some(vin) = first_vin_candidate(vin_re, value) {
            *counts.entry(vin).or_insert(0) += 1;
        }
    }
    counts
}

fn count_ocr_vins(rows: &[MatchRow]) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for row in rows {
        if row.ocr_vin.len() == 17 {
            *counts.entry(row.ocr_vin.clone()).or_insert(0) += 1;
        }
    }
    counts
}

fn apply_checks(row: &mut MatchRow, reg_duplicate_count: usize, ocr_duplicate_count: usize) {
    row.reg_duplicate = reg_duplicate_count > 1;
    row.ocr_duplicate = ocr_duplicate_count > 1;
    row.matched =
        !row.reg_vin.is_empty() && row.ocr_vin != "未识别到" && row.reg_vin == row.ocr_vin;
    row.reg_len_ok = row.reg_vin.len() == 17;
    row.ocr_len_ok = row.ocr_vin.len() == 17;
    row.reg_check_ok = vin_check_digit_ok(&row.reg_vin);
    row.ocr_check_ok = vin_check_digit_ok(&row.ocr_vin);
    row.status = match_status(
        &row.reg_vin,
        &row.ocr_vin,
        reg_duplicate_count,
        ocr_duplicate_count,
    )
    .to_string();
}

fn row_payload(row: &MatchRow, total: usize) -> serde_json::Value {
    json!({
        "type": "progress",
        "row": row.row_num,
        "name": row.name,
        "reg_vin": row.reg_vin,
        "ocr_vin": row.ocr_vin,
        "all_vins": row.all_vins,
        "status": row.status,
        "reg_duplicate": row.reg_duplicate,
        "ocr_duplicate": row.ocr_duplicate,
        "matched": row.matched,
        "reg_len_ok": row.reg_len_ok,
        "ocr_len_ok": row.ocr_len_ok,
        "reg_check_ok": row.reg_check_ok,
        "ocr_check_ok": row.ocr_check_ok,
        "texts_debug": row.texts_debug,
        "current": total,
        "total": total
    })
}

fn match_status(
    reg_vin: &str,
    ocr_vin: &str,
    reg_duplicate_count: usize,
    ocr_duplicate_count: usize,
) -> &'static str {
    if reg_vin.is_empty() || ocr_vin == "未识别到" {
        return "匹配失败";
    }
    if reg_duplicate_count > 1
        || ocr_duplicate_count > 1
        || !vin_check_digit_ok(reg_vin)
        || !vin_check_digit_ok(ocr_vin)
    {
        return "匹配失败";
    }
    if reg_vin != ocr_vin {
        return "不匹配";
    }
    "匹配"
}

fn yes_no(value: bool) -> &'static str {
    if value {
        "是"
    } else {
        "否"
    }
}

fn vin_check_digit_ok(vin: &str) -> bool {
    vin.len() == 17
        && vin_expected_check_digit(vin).is_some_and(|ch| vin.as_bytes()[8] as char == ch)
}

fn vin_expected_check_digit(vin: &str) -> Option<char> {
    if vin.len() != 17 {
        return None;
    }
    let weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = vin
        .chars()
        .zip(weights)
        .try_fold(0u32, |sum, (ch, weight)| {
            vin_value(ch).map(|value| sum + value * weight)
        })?;
    Some(match sum % 11 {
        10 => 'X',
        value => (b'0' + value as u8) as char,
    })
}

fn vin_value(ch: char) -> Option<u32> {
    match ch {
        '0'..='9' => Some(ch as u32 - '0' as u32),
        'A' | 'J' => Some(1),
        'B' | 'K' | 'S' => Some(2),
        'C' | 'L' | 'T' => Some(3),
        'D' | 'M' | 'U' => Some(4),
        'E' | 'N' | 'V' => Some(5),
        'F' | 'W' => Some(6),
        'G' | 'P' | 'X' => Some(7),
        'H' | 'Y' => Some(8),
        'R' | 'Z' => Some(9),
        _ => None,
    }
}

fn find_header_row(cells: &BTreeMap<(usize, String), String>) -> usize {
    (1..=5)
        .find(|row_num| {
            (1..=60)
                .filter(|idx| {
                    let col = index_to_col(*idx);
                    cells
                        .get(&(*row_num, col))
                        .is_some_and(|value| !value.trim().is_empty())
                })
                .count()
                > 3
        })
        .unwrap_or(1)
}

fn guess_name(cells: &BTreeMap<(usize, String), String>, row_num: usize) -> String {
    let zh_name = Regex::new(r"^[\u{4e00}-\u{9fa5}]{2,4}$").ok();
    for col_idx in 1..=8 {
        let col = index_to_col(col_idx);
        let Some(value) = cells.get(&(row_num, col)) else {
            continue;
        };
        if zh_name.as_ref().is_some_and(|re| re.is_match(value.trim())) {
            return value.trim().to_string();
        }
    }
    format!("第 {row_num} 行")
}

fn find_model_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("ocr-models"));
    }
    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("src-tauri").join("ocr-models"));
        candidates.push(current_dir.join("ocr-models"));
    }

    candidates
        .into_iter()
        .find(|dir| {
            dir.join("PP-OCRv6_tiny_det.mnn").exists()
                && dir.join("PP-OCRv6_tiny_rec.mnn").exists()
                && dir.join("ppocr_keys_v6_tiny.txt").exists()
        })
        .ok_or_else(|| "未找到 Rust OCR 模型文件 ocr-models/PP-OCRv6_tiny_*.mnn".to_string())
}

fn output_path(path: &Path) -> PathBuf {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("xlsx");
    dir.join(format!("{stem}_ocr比对结果.{ext}"))
}

fn emit_status(
    window: &tauri::Window,
    message: &str,
    current: Option<usize>,
    total: Option<usize>,
) {
    let mut payload = json!({
        "type": "status",
        "message": message,
    });
    if let Some(current) = current {
        payload["current"] = json!(current);
    }
    if let Some(total) = total {
        payload["total"] = json!(total);
    }
    let _ = window.emit("ocr-progress", payload.to_string());
}

fn emit_error(window: &tauri::Window, message: &str) {
    let _ = window.emit(
        "ocr-progress",
        json!({
            "status": "error",
            "message": message
        })
        .to_string(),
    );
}

fn read_zip_entry(archive: &mut ZipArchive<File>, name: &str) -> Result<Vec<u8>, String> {
    let mut file = archive.by_name(name).map_err(|e| e.to_string())?;
    let mut data = Vec::new();
    file.read_to_end(&mut data).map_err(|e| e.to_string())?;
    Ok(data)
}

fn read_zip_text(archive: &mut ZipArchive<File>, name: &str) -> Result<String, String> {
    String::from_utf8(read_zip_entry(archive, name)?).map_err(|e| e.to_string())
}

fn read_zip_text_optional(archive: &mut ZipArchive<File>, name: &str) -> Result<String, String> {
    match archive.by_name(name) {
        Ok(mut file) => {
            let mut text = String::new();
            file.read_to_string(&mut text).map_err(|e| e.to_string())?;
            Ok(text)
        }
        Err(_) => Ok(String::new()),
    }
}

fn capture_tag_usize(xml: &str, tag: &str) -> Option<usize> {
    Regex::new(&format!(
        r#"(?s)<{}>(\d+)</{}>"#,
        regex::escape(tag),
        regex::escape(tag)
    ))
    .ok()?
    .captures(xml)?
    .get(1)?
    .as_str()
    .parse()
    .ok()
}

fn capture_attr(xml: &str, tag: &str, attr: &str) -> Option<String> {
    Regex::new(&format!(
        r#"<{}\b[^>]*\b{}="([^"]+)""#,
        regex::escape(tag),
        regex::escape(attr)
    ))
    .ok()?
    .captures(xml)?
    .get(1)
    .map(|m| m.as_str().to_string())
}

fn find_relationship_target(rels_xml: &str, id: &str) -> Option<String> {
    let relationship_re = Regex::new(r#"<Relationship\b([^>]*)/?>"#).ok()?;
    let attr_re = Regex::new(r#"([A-Za-z:]+)="([^"]*)""#).ok()?;
    for cap in relationship_re.captures_iter(rels_xml) {
        let attrs = cap.get(1).map(|m| m.as_str()).unwrap_or_default();
        let attrs = attr_re
            .captures_iter(attrs)
            .filter_map(|cap| Some((cap.get(1)?.as_str(), cap.get(2)?.as_str())))
            .collect::<HashMap<_, _>>();
        if attrs.get("Id") == Some(&id) {
            return attrs.get("Target").map(|target| target.to_string());
        }
    }
    None
}

fn drawing_rels_path(drawing_path: &str) -> Result<String, String> {
    let path = Path::new(drawing_path);
    let file = path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| format!("无效 drawing 路径: {drawing_path}"))?;
    let parent = path
        .parent()
        .and_then(|s| s.to_str())
        .unwrap_or("xl/drawings");
    Ok(format!("{parent}/_rels/{file}.rels"))
}

fn resolve_zip_path(base_dir: &str, target: &str) -> String {
    let mut parts = base_dir
        .split('/')
        .filter(|part| !part.is_empty())
        .map(|part| part.to_string())
        .collect::<Vec<_>>();
    for part in target.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            value => parts.push(value.to_string()),
        }
    }
    parts.join("/")
}

fn split_cell_ref(cell_ref: &str) -> Option<(String, usize)> {
    let mut col = String::new();
    let mut row = String::new();
    for ch in cell_ref.chars() {
        if ch.is_ascii_alphabetic() {
            col.push(ch);
        } else if ch.is_ascii_digit() {
            row.push(ch);
        }
    }
    Some((col, row.parse().ok()?))
}

fn col_to_index(col: &str) -> Result<usize, String> {
    let mut index = 0usize;
    for ch in col.trim().chars() {
        if !ch.is_ascii_alphabetic() {
            return Err(format!("无效列名: {col}"));
        }
        index = index * 26 + (ch.to_ascii_uppercase() as usize - 'A' as usize + 1);
    }
    Ok(index)
}

fn index_to_col(mut index: usize) -> String {
    let mut col = String::new();
    while index > 0 {
        index -= 1;
        col.insert(0, (b'A' + (index % 26) as u8) as char);
        index /= 26;
    }
    col
}

fn xml_unescape(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#10;", "\n")
        .replace("&amp;", "&")
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sample_xlsx_headers_and_images() {
        let path = Path::new("/private/tmp/fdr-ocr-v6-test.xlsx");
        if !path.exists() {
            return;
        }

        let data = read_xlsx_data(path).expect("sample xlsx should parse");
        assert_eq!(
            data.cells.get(&(2, "D".to_string())).map(String::as_str),
            Some("车辆识别代号/车架号")
        );
        assert!(data.images.len() >= 40);
        assert!(data
            .images
            .iter()
            .any(|task| task.row_num == 4 && task.image_path.starts_with("xl/media/")));
    }

    #[test]
    fn rust_ocr_matches_first_sample_image() {
        let path = Path::new("/private/tmp/fdr-ocr-v6-test.xlsx");
        let model_dir = Path::new("ocr-models");
        if !path.exists() || !model_dir.exists() {
            return;
        }

        let data = read_xlsx_data(path).expect("sample xlsx should parse");
        let task = data
            .images
            .iter()
            .find(|task| task.row_num == 4)
            .expect("sample should have row 4 image");
        let file = File::open(path).expect("sample should open");
        let mut archive = ZipArchive::new(file).expect("sample should be xlsx zip");
        let image_bytes =
            read_zip_entry(&mut archive, &task.image_path).expect("image should read");
        let image = image::load_from_memory(&image_bytes).expect("image should decode");
        let engine = OcrEngine::new(
            model_dir.join("PP-OCRv6_tiny_det.mnn"),
            model_dir.join("PP-OCRv6_tiny_rec.mnn"),
            model_dir.join("ppocr_keys_v6_tiny.txt"),
            Some(OcrEngineConfig::fast().with_min_result_confidence(0.5)),
        )
        .expect("rust ocr should init");
        let texts = recognize_texts(&engine, &image).expect("rust ocr should recognize");
        let vin_re = Regex::new(r"(?i)[A-HJ-NPR-Z0-9]{17}").unwrap();
        let vins = collect_vins(&vin_re, &texts);
        assert!(vins.contains(&"LDP45B961TG517934".to_string()), "{texts:?}");
    }

    #[test]
    fn vin_candidate_is_extracted_before_validation() {
        let vin_re = Regex::new(r"(?i)[A-Z0-9]{17}").unwrap();
        let texts = vec!["6.车辆识别代号/车架号LGJEIEE06TM541766".to_string()];
        let vins = collect_vins(&vin_re, &texts);
        assert_eq!(vins, vec!["LGJEIEE06TM541766"]);
        assert!(!vin_check_digit_ok(&vins[0]));
    }

    #[test]
    fn vin_check_digit_uses_gb_iso_rule() {
        assert_eq!(vin_expected_check_digit("LDP45B961TG517934"), Some('1'));
        assert!(vin_check_digit_ok("LDP45B961TG517934"));
    }

    #[test]
    fn match_result_checks_both_registered_and_ocr_columns() {
        let mut row = MatchRow {
            row_num: 1,
            name: String::new(),
            reg_vin: "LDP45B961TG517934".to_string(),
            ocr_vin: "LDP45B961TG517934".to_string(),
            all_vins: String::new(),
            texts_debug: String::new(),
            status: String::new(),
            reg_duplicate: false,
            ocr_duplicate: false,
            matched: false,
            reg_len_ok: false,
            ocr_len_ok: false,
            reg_check_ok: false,
            ocr_check_ok: false,
        };
        apply_checks(&mut row, 1, 2);
        assert_eq!(row.status, "匹配失败");
        assert!(!row.reg_duplicate);
        assert!(row.ocr_duplicate);
        assert!(row.matched);
        assert!(row.reg_check_ok);
        assert!(row.ocr_check_ok);
    }

    #[test]
    fn invalid_ocr_vin_is_failed_not_mismatch() {
        assert_eq!(
            match_status("LDP45B961TG517934", "LGJEIEE06TM541766", 1, 1),
            "匹配失败"
        );
    }

    #[test]
    fn folder_vin_ignores_serial_prefix() {
        let vin_re = Regex::new(r"(?i)[A-Z0-9]{17}").unwrap();
        assert_eq!(
            folder_vin_candidate(&vin_re, "1-LVTDB21B6TH028185").as_deref(),
            Some("LVTDB21B6TH028185")
        );
        assert_eq!(
            folder_vin_candidate(&vin_re, "10-LVVDC21B0TD171810").as_deref(),
            Some("LVVDC21B0TD171810")
        );
        assert_eq!(
            folder_vin_candidate(&vin_re, "12-LVTDB21B8SDE35031").as_deref(),
            Some("LVTDB21B8SDE35031")
        );
    }

    #[test]
    fn folder_mode_prefers_certificate_file() {
        let dir = std::env::temp_dir().join("fdr-ocr-folder-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("汽车买卖合同.pdf"), b"contract").unwrap();
        fs::write(dir.join("1合格证.pdf"), b"cert").unwrap();

        let picked = find_certificate_file(&dir).unwrap();
        assert_eq!(
            picked.file_name().and_then(|name| name.to_str()),
            Some("1合格证.pdf")
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn extracts_images_from_real_certificate_pdf_when_present() {
        let path = Path::new("/Users/jiebo/Downloads/中交租赁&福清城投第六期非标融资租赁物明细台账20260630/27-LVTDB21B2TDB81947/27合格证.pdf");
        if !path.exists() {
            return;
        }
        let images = extract_pdf_images(path).expect("certificate pdf images should extract");
        assert!(!images.is_empty());
    }
}
