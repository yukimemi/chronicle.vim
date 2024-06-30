" =============================================================================
" File        : read.vim
" Author      : yukimemi
" Last Change : 2024/06/30 22:03:13.
" =============================================================================

function! chronicle#read#list() abort
  call denops#plugin#wait('chronicle')
  return denops#request('chronicle', 'listRead', [])
endfunction

function! chronicle#read#open() abort
  call denops#plugin#wait('chronicle')
  return denops#notify('chronicle', 'open', [g:chronicle_read_path])
endfunction

