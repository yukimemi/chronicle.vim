if exists('g:loaded_chronicle')
  finish
endif
let g:loaded_chronicle = 1

command! OpenChronicleRead call chronicle#read#open()
command! OpenChronicleWrite call chronicle#write#open()

let g:chronicle_read_path = get(g:, 'chronicle_read_path', expand('~/.chronicle/read'))
let g:chronicle_write_path = get(g:, 'chronicle_write_path', expand('~/.chronicle/write'))

