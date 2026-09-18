use crate::storage::{err, Result, Store};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageFormat, ImageReader};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Cursor;

#[derive(Serialize)]
pub struct ImageResult {
    pub id: i64,
    pub url: String,
    pub width: u32,
    pub height: u32,
}
impl Store {
    pub fn add_image(&self, encoded: &str) -> Result<ImageResult> {
        if encoded.len() > 35 * 1024 * 1024 {
            return Err("Images must be smaller than 25 MiB".into());
        }
        let input = STANDARD.decode(encoded).map_err(err)?;
        if input.len() > 25 * 1024 * 1024 {
            return Err("Images must be smaller than 25 MiB".into());
        }
        let reader = ImageReader::new(Cursor::new(&input))
            .with_guessed_format()
            .map_err(err)?;
        let format = reader.format().ok_or("Unsupported image format")?;
        let (width, height) = reader.into_dimensions().map_err(err)?;
        if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 40_000_000 {
            return Err("Images must be under 40 megapixels".into());
        }
        let (bytes, mime) = if matches!(format, ImageFormat::Png | ImageFormat::Jpeg) {
            (
                input,
                if format == ImageFormat::Png {
                    "image/png"
                } else {
                    "image/jpeg"
                },
            )
        } else {
            let img = image::load_from_memory(&input).map_err(err)?;
            let mut output = Cursor::new(Vec::new());
            img.write_to(&mut output, ImageFormat::Png).map_err(err)?;
            (output.into_inner(), "image/png")
        };
        if bytes.len() > 25 * 1024 * 1024 {
            return Err("Converted image exceeds 25 MiB".into());
        }
        let hash = format!("{:x}", Sha256::digest(&bytes));
        self.conn.execute("INSERT OR IGNORE INTO images(sha256,mime,width,height,bytes) VALUES(?1,?2,?3,?4,?5)",params![hash,mime,width,height,bytes]).map_err(err)?;
        let id = self
            .conn
            .query_row("SELECT id FROM images WHERE sha256=?1", [hash], |r| {
                r.get(0)
            })
            .map_err(err)?;
        Ok(ImageResult {
            id,
            url: format!("data:{mime};base64,{}", STANDARD.encode(&bytes)),
            width,
            height,
        })
    }
    pub fn image(&self, id: i64) -> Result<ImageResult> {
        self.conn
            .query_row(
                "SELECT mime,bytes,width,height FROM images WHERE id=?1",
                [id],
                |r| {
                    let mime: String = r.get(0)?;
                    let bytes: Vec<u8> = r.get(1)?;
                    Ok(ImageResult {
                        id,
                        url: format!("data:{mime};base64,{}", STANDARD.encode(bytes)),
                        width: r.get(2)?,
                        height: r.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(err)?
            .ok_or("Image is missing".into())
    }
}
