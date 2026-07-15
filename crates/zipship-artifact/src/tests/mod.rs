use std::{
    fs::{self, File},
    io::Write,
    path::Path,
};

use tempfile::tempdir;
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

use super::*;

mod extraction;
mod limits;
mod path_security;
mod root_detection;

fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
    let file = File::create(path).unwrap();
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (name, contents) in entries {
        writer.start_file(*name, options).unwrap();
        writer.write_all(contents).unwrap();
    }
    writer.finish().unwrap();
}
